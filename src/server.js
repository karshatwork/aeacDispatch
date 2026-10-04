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
const { recoverStaleTransactions, autoCleanupOpenDispatches } = require('./services/fifoService');
const { validateLicense, getMachineFingerprint, getLicenseCandidates } = require('./utils/licenseEngine');

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
        const isProduction = process.env.NODE_ENV === 'production';
        const expectedSecret = process.env.DESKTOP_SECRET;
        if (isTestEnv || !isProduction) return callback(true);

        const urlParams = new URLSearchParams(info.req.url.replace(/^[^?]*\?/, ''));
        const secret = urlParams.get('desktopSecret') || info.req.headers['x-desktop-secret'];
        const origin = info.req.headers.origin || '';
        const clientRole = urlParams.get('role') || info.req.headers['x-client-role'];

        // Authorized Electron window
        if ((expectedSecret && secret === expectedSecret) || origin === 'app://dispatch' || origin === 'app://packing') {
            return callback(true);
        }

        // Allow localhost scanner tools / emulator
        const remoteIp = info.req.socket?.remoteAddress || '';
        const isLocalhost = !remoteIp || remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
        if (isLocalhost && (!origin || clientRole === 'scanner' || clientRole === 'emulator')) {
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

    // Support simulated scans over WebSocket
    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw.toString());
            if (data.type === 'SIMULATE_SCAN' && data.payload) {
                const qr = typeof data.payload === 'string' ? data.payload : (data.payload.qrData || data.payload.scannedPayload);
                if (qr) scannerService.simulateScan(qr);
            }
        } catch (e) { }
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
// ============================================================================
// ENVIRONMENT & DESKTOP GATEWAY SECURITY
// In production (NODE_ENV=production):
//   - Static file hosting (express.static) is disabled.
//   - Non-API routes return 403 Access Denied.
//   - API routes require the authorized Electron Desktop Secret (or app:// origin).
// In development (NODE_ENV=development):
//   - Static files are served from /public so developers can debug in Chrome/Edge.
// ============================================================================
const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
const isProduction = process.env.NODE_ENV === 'production';

app.use((req, res, next) => {
    // In production mode, enforce strict Desktop Electron lockdown
    if (isProduction && !isTestEnv) {
        // Block all non-API and non-asset web page requests from regular browsers
        if (!req.path.startsWith('/api') && !req.path.startsWith('/assets') && req.path !== '/favicon.ico') {
            return res.status(403).send('403 Access Denied: Application is only accessible via the official RecordKeeper Desktop Application.');
        }

        // For API requests, verify the request originates from the authorized Electron desktop client
        const expectedSecret = process.env.DESKTOP_SECRET;
        const secretFromHeader = req.headers['x-desktop-secret'];
        const secretFromQuery = req.query.desktopSecret;
        const origin = req.headers.origin || '';

        const isAuthorized = (expectedSecret && secretFromHeader === expectedSecret) ||
            (expectedSecret && secretFromQuery === expectedSecret) ||
            (origin === 'app://dispatch');

        if (!isAuthorized && req.path.startsWith('/api')) {
            return res.status(403).json({
                success: false,
                error: '403 Access Denied: Unauthorized client connection. Desktop Application required.'
            });
        }
    }

    next();
});

// Serve frontend static assets (available in both dev and production for document generation)
app.use('/assets', express.static(assetsPath));
if (!isProduction) {
    app.use(express.static(publicPath));
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
// Strict License Enforcement Gate
// Whitelist health check and license activation so the Terminal Lock Screen can function.
// All business logic routes (/api/auth, /api/boxes, /api/dispatch, /api/reports, /api/trace)
// are strictly halted with 403 when unlicensed.
app.use((req, res, next) => {
    if (isTestEnv || !req.path.startsWith('/api')) return next();

    if (req.path === '/api/system/health' || req.path.startsWith('/api/system/license')) {
        return next();
    }

    const licenseCandidates = getLicenseCandidates();
    const activeLicensePath = licenseCandidates.find(p => fs.existsSync(p));
    const currentMachine = getMachineFingerprint();

    if (!activeLicensePath) {
        return res.status(403).json({
            success: false,
            error: 'Terminal Locked: No license key installed on this system',
            licenseRequired: true,
            machineCode: currentMachine
        });
    }

    const licResult = validateLicense(activeLicensePath);
    if (!licResult.valid) {
        return res.status(403).json({
            success: false,
            error: `Terminal Locked: ${licResult.error}`,
            licenseRequired: true,
            machineCode: currentMachine,
            licenseError: licResult.error
        });
    }

    next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/boxes', boxRoutes);
app.use('/api/dispatch', dispatchRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/trace', traceRoutes);
app.use('/api/system', systemRoutes);

// SPA fallback: in dev mode serve index.html for any non-API unmatched route
// In production mode, reject any unhandled routes with 403 Access Denied
if (!isProduction) {
    app.get('*', (req, res) => {
        res.sendFile(path.join(publicPath, 'index.html'));
    });
} else {
    app.use((req, res) => {
        res.status(403).send('403 Access Denied: Application is only accessible via the official RecordKeeper Desktop Application.');
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

        // Start background batch sync worker (every 5 minutes / 300000ms)
        const syncInterval = parseInt(process.env.SYNC_INTERVAL_MS || '300000', 10);
        startSyncWorker(syncInterval);

        // Periodic background sweeper for inactive/abandoned in_progress dispatches (runs every 60s)
        setInterval(async () => {
            try {
                await autoCleanupOpenDispatches({
                    reason: 'Session timed out after 45 minutes of inactivity',
                    maxAgeMinutes: 45
                });
            } catch (e) {
                console.error('[INACTIVITY SWEEPER ERROR]', e.message);
            }
        }, 60000);


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
