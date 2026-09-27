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
        if (!EXPECTED_APP_TOKEN) return callback(true);
        const cookies = parseCookies(info.req.headers.cookie);
        const urlParams = new URLSearchParams(info.req.url.replace(/^[^?]*\?/, ''));
        const token = urlParams.get('authToken') || cookies['rk_app_token'] || info.req.headers['x-app-token'];
        if (token === EXPECTED_APP_TOKEN) {
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
// Security guard: restrict access exclusively to authorized desktop host window
app.use((req, res, next) => {
    if (!EXPECTED_APP_TOKEN) {
        return next();
    }

    const tokenFromQuery = req.query.authToken || req.query.token;
    const cookies = parseCookies(req.headers.cookie);
    const tokenFromCookie = cookies['rk_app_token'];
    const tokenFromHeader = req.headers['x-app-token'] || req.headers['x-auth-token'];

    const isValid = (tokenFromQuery === EXPECTED_APP_TOKEN) ||
                    (tokenFromCookie === EXPECTED_APP_TOKEN) ||
                    (tokenFromHeader === EXPECTED_APP_TOKEN);

    if (!isValid) {
        // Abort TCP connection immediately - browser displays ERR_EMPTY_RESPONSE / connection dropped,
        // exactly like navigating to an unopened port!
        if (req.socket && !req.socket.destroyed) {
            req.socket.destroy();
        }
        return;
    }

    // Set cookie if token was provided in query or header so all subsequent assets & requests are authenticated
    if (tokenFromQuery === EXPECTED_APP_TOKEN) {
        res.setHeader('Set-Cookie', 'rk_app_token=' + EXPECTED_APP_TOKEN + '; Path=/; HttpOnly; SameSite=Strict');
    }

    next();
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend UI and assets
const publicPath = fs.existsSync(path.join(__dirname, '../public'))
    ? path.join(__dirname, '../public')
    : path.join(__dirname, 'public');

const assetsPath = fs.existsSync(path.join(__dirname, '../assets'))
    ? path.join(__dirname, '../assets')
    : path.join(__dirname, 'assets');

// Auth Launch Handshake: Exchanges startup token for cookie and immediately redirects to '/'
// This prevents exposing tokens in the browser URL bar, window title, or history!
app.get('/auth-launch', (req, res) => {
    const token = req.query.token || req.query.authToken;
    if (EXPECTED_APP_TOKEN && token !== EXPECTED_APP_TOKEN) {
        if (req.socket && !req.socket.destroyed) {
            req.socket.destroy();
        }
        return;
    }
    if (EXPECTED_APP_TOKEN) {
        res.setHeader('Set-Cookie', 'rk_app_token=' + EXPECTED_APP_TOKEN + '; Path=/; HttpOnly; SameSite=Strict');
    }
    res.redirect('/');
});

// Root Favicon handler with explicit MIME type & binary delivery
app.get('/favicon.ico', (req, res) => {
    const icoPath = fs.existsSync(path.join(publicPath, 'favicon.ico'))
        ? path.join(publicPath, 'favicon.ico')
        : path.join(assetsPath, 'favicon.ico');
    if (fs.existsSync(icoPath)) {
        res.setHeader('Content-Type', 'image/x-icon');
        return res.sendFile(icoPath);
    }
    res.status(204).end();
});

app.use(express.static(publicPath));
app.use('/assets', express.static(assetsPath));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/boxes', boxRoutes);
app.use('/api/dispatch', dispatchRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/trace', traceRoutes);
app.use('/api/system', systemRoutes);

// Fallback to SPA index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

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
            console.error(`[FATAL LICENSE ERROR] No 'license.key' found in application directory! Machine code: ${currentMachine}`);
            throw new Error(`[LICENSE ERROR] Missing license.key file. Current Machine Code: ${currentMachine}`);
        }

        const licResult = validateLicense(activeLicensePath);
        if (!licResult.valid) {
            console.error(`[FATAL LICENSE ERROR] ${licResult.error}`);
            throw new Error(`[LICENSE ERROR] ${licResult.error}`);
        }

        console.log(`[LICENSE] Active & Verified: ${licResult.message}`);

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
            console.log(`[HTTP SERVER] Running on http://localhost:${PORT}`);
            console.log(`[STATUS] Ready to service C# WebView2 host and terminal users.`);
        });
    } catch (err) {
        console.error('[BOOTSTRAP ERROR]', err.message);
        if (err.message && err.message.includes('[LICENSE ERROR]')) {
            console.error('[FATAL LICENSE EXCEPTION] Halting application engine due to license failure.');
            process.exit(1);
        }
        // Do not crash process for MongoDB disconnection, keep server listening so user can configure DB via UI if offline
        server.listen(PORT, () => {
            console.log(`[HTTP SERVER (SAFE MODE)] Running on http://localhost:${PORT} (Database offline)`);
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
