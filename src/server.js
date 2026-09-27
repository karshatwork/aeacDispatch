// src/server.js
const { initEnvironment } = require('./utils/cryptoConfig');
initEnvironment();

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');

const { connectDB } = require('./config/db');
const { autoSeedAdmin } = require('./services/authService');
const { startSyncWorker } = require('./services/syncService');
const { recoverStaleTransactions } = require('./services/fifoService');
const { validateLicense, getMachineFingerprint } = require('./utils/licenseEngine');
const scannerService = require('./services/scannerService');

// Route modules
const authRoutes = require('./routes/authRoutes');
const boxRoutes = require('./routes/boxRoutes');
const dispatchRoutes = require('./routes/dispatchRoutes');
const reportRoutes = require('./routes/reportRoutes');
const traceRoutes = require('./routes/traceRoutes');
const systemRoutes = require('./routes/systemRoutes');

const app = express();
const server = http.createServer(app);

// Resolved paths for static file serving (used in dev/browser mode only)
const publicPath = path.join(__dirname, '..', 'public');
const assetsPath = path.join(__dirname, '..', 'assets');

// Extract authorized app token from CLI or environment
const appTokenArg = process.argv.find(a => a && a.startsWith('--app-token='));
const EXPECTED_APP_TOKEN = (appTokenArg ? appTokenArg.split('=')[1] : null) || process.env.APP_TOKEN || null;

function parseCookies(cookieHeader) {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach(cookie => {
        const idx = cookie.indexOf('=');
        if (idx === -1) return;
        const name = cookie.substring(0, idx).trim();
        const value = cookie.substring(idx + 1).trim();
        if (name) {
            try {
                list[name] = decodeURIComponent(value);
            } catch (e) {
                list[name] = value;
            }
        }
    });
    return list;
}

// WebSocket server for real-time live scanner & box telemetry
const wss = new WebSocketServer({
    server,
    verifyClient: (info, callback) => {
        const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
        const expectedSecret = process.env.DESKTOP_SECRET;
        if (isTestEnv || !expectedSecret) return callback(true);

        const urlParams = new URLSearchParams(info.req.url.replace(/^[^?]*\?/, ''));
        const secret = urlParams.get('desktopSecret') || info.req.headers['x-desktop-secret'];
        const origin = info.req.headers.origin || '';

        if (secret === expectedSecret || origin === 'app://dispatch') {
            return callback(true);
        }

        if (info.req.socket && !info.req.socket.destroyed) {
            info.req.socket.destroy();
        }
        callback(false);
    }
});

wss.on('connection', (ws) => {
    // Send initial scanner status
    ws.send(JSON.stringify({
        type: 'SCANNER_STATUS',
        payload: scannerService.getStatus()
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'TEST_SCAN') {
                scannerService.simulateScan(data.payload);
            }
        } catch (e) {}
    });
});

// Broadcast helper
function broadcast(type, payload) {
    const msg = JSON.stringify({ type, payload });
    wss.clients.forEach((client) => {
        if (client.readyState === 1) { // OPEN
            client.send(msg);
        }
    });
}

// Hook scanner service events to WebSocket clients
scannerService.on('scan', (qrPayload) => {
    broadcast('SCANNER_DATA', { qrData: qrPayload, timestamp: new Date() });
});

scannerService.on('status', (status) => {
    broadcast('SCANNER_STATUS', status);
});

// Middleware
// When DESKTOP_SECRET is set (packaged Electron exe), the backend is locked down:
//   - Non-API requests → socket destroyed immediately (ERR_EMPTY_RESPONSE)
//   - API requests     → must carry the ephemeral secret header/query
// When DESKTOP_SECRET is NOT set (dev mode / npm run dev), the SPA is served
// normally so the browser can access the app for development.
const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);

app.use((req, res, next) => {
    const expectedSecret = process.env.DESKTOP_SECRET;
    const isProtected = Boolean(expectedSecret) && !isTestEnv;

    if (!req.path.startsWith('/api')) {
        if (isProtected) {
            // Production exe: drop connection so browser gets ERR_EMPTY_RESPONSE
            if (req.socket && !req.socket.destroyed) req.socket.destroy();
            return;
        }
        // Dev mode: fall through to static file serving below
        return next();
    }

    // API path
    if (isTestEnv || !expectedSecret) return next();

    // Verify the request is from the authorised Electron host
    const secretFromHeader = req.headers['x-desktop-secret'];
    const secretFromQuery  = req.query.desktopSecret;
    const origin           = req.headers.origin || '';

    const isAuthorized = (secretFromHeader === expectedSecret) ||
                         (secretFromQuery  === expectedSecret) ||
                         (origin === 'app://dispatch');

    if (!isAuthorized) {
        if (req.socket && !req.socket.destroyed) req.socket.destroy();
        return;
    }

    next();
});

// Dev-mode static file serving (skipped when DESKTOP_SECRET is active)
if (!process.env.DESKTOP_SECRET) {
    app.use(express.static(publicPath));
    app.use('/assets', express.static(assetsPath));
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/boxes', boxRoutes);
app.use('/api/dispatch', dispatchRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/trace', traceRoutes);
app.use('/api/system', systemRoutes);

// SPA fallback: in dev mode serve index.html for any non-API unmatched route
// In protected mode the guard above already dropped non-API connections, so this never fires.
if (!process.env.DESKTOP_SECRET) {
    app.get('*', (req, res) => {
        res.sendFile(path.join(publicPath, 'index.html'));
    });
}

const PORT = process.env.PORT || 4000;

async function bootstrap() {
    try {
        console.log('==================================================');
        // License & Hardware Verification
        const licenseCandidates = [
            path.join(process.cwd(), 'license.key'),
            path.join(__dirname, '../license.key'),
            path.join(__dirname, 'license.key')
        ];
        const activeLicensePath = licenseCandidates.find(p => fs.existsSync(p));
        const currentMachine = getMachineFingerprint();

        if (!activeLicensePath) {
            console.warn(`[LICENSE NOTICE] No 'license.key' found. System in Unlicensed Mode. Machine Code: ${currentMachine}`);
        } else {
            const licResult = validateLicense(activeLicensePath);
            if (!licResult.valid) {
                console.warn(`[LICENSE NOTICE] ${licResult.error}. System in Unlicensed Mode.`);
            } else {
                console.log(`[LICENSE] Active & Verified: ${licResult.message}`);
            }
        }

        // Connect to MongoDB
        await connectDB();

        // Auto-seed default Administrator account if not exists
        await autoSeedAdmin();

        // Crash recovery: check for any dangling in_progress transactions
        await recoverStaleTransactions();

        // Start background batch sync worker (every 3 seconds)
        const syncInterval = parseInt(process.env.SYNC_INTERVAL_MS || '3000', 10);
        startSyncWorker(syncInterval);

        // Attempt initial COM port connection for scanner
        const comPort = process.env.COM_PORT || 'COM3';
        const baudRate = parseInt(process.env.COM_BAUD_RATE || '9600', 10);
        scannerService.connect(comPort, baudRate);

        server.listen(PORT, () => {
            console.log(`[HTTP SERVER] Running on http://127.0.0.1:${PORT}`);
            console.log(`[STATUS] Service active and ready for Electron host.`);
        });
    } catch (err) {
        console.error('[BOOTSTRAP ERROR]', err.message);
        // Do not crash process for MongoDB disconnection, keep server listening so user can configure DB via UI if offline
        server.listen(PORT, () => {
            console.log(`[HTTP SERVER (SAFE MODE)] Running on http://127.0.0.1:${PORT} (Database offline)`);
        });
    }
}

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.warn(`[PORT WARNING] Port ${PORT} is already in use by another instance or server.`);
    } else {
        console.error('[HTTP SERVER ERROR]', err.message);
    }
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('[SYSTEM] Shutting down cleanly...');
    scannerService.disconnect();
    server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
    console.log('[SYSTEM] Terminating process...');
    scannerService.disconnect();
    server.close(() => process.exit(0));
});

const isTestRunner = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
if (!isTestRunner && (require.main === module || !module.parent)) {
    bootstrap().catch(err => {
        console.error('[FATAL BOOTSTRAP EXCEPTION]', err);
    });
}

module.exports = { app, server, bootstrap };
