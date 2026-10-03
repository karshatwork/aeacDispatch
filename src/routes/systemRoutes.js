// src/routes/systemRoutes.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { testConnection, getStatus, connectDB } = require('../config/db');
const { SyncState, SystemSettings, DispatchUser } = require('../models');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { updateConfigValue } = require('../utils/cryptoConfig');
const { getMachineFingerprint, validateLicense, activateLicense } = require('../utils/licenseEngine');
const syncService = require('../services/syncService');
const scannerService = require('../services/scannerService');

// GET /api/system/health - Public health check for DB & scanner status (no auth required)
router.get('/health', async (req, res) => {
    const dbStatus = getStatus();
    const scannerStatus = scannerService.getStatus();
    const machineCode = getMachineFingerprint();
    let syncState = null;
    if (dbStatus && dbStatus.isConnected) {
        try {
            syncState = await SyncState.findOne({ key: 'global_sync' });
        } catch (e) { }
    }
    const licenseCandidates = [
        path.join(process.cwd(), 'license.key'),
        path.join(__dirname, '../../license.key'),
        path.join(__dirname, '../license.key')
    ];
    const keyPath = licenseCandidates.find(p => fs.existsSync(p));
    let license = { valid: false, machineCode, error: 'No license key installed on this system' };
    if (keyPath) {
        license = validateLicense(keyPath);
        license.machineCode = machineCode;
    }

    res.json({
        success: true,
        database: dbStatus,
        sync: {
            watermark: syncState ? syncState.lastSyncedClosedAt : null,
            lastRun: syncState ? syncState.lastSyncRunAt : null,
            totalSyncedBoxes: syncState ? syncState.totalSyncedBoxes : 0
        },
        scanner: scannerStatus,
        license,
        serverTime: new Date()
    });
});

// Helper to locate project legal markdown files across dev and packaged runtimes
function findLegalDocument(filename) {
    const candidates = [
        path.join(process.cwd(), filename),
        path.join(__dirname, '../../', filename),
        path.join(__dirname, '../', filename),
        path.join(__dirname, '../../../', filename),
        process.execPath ? path.join(path.dirname(process.execPath), filename) : null,
        process.execPath ? path.join(path.dirname(process.execPath), 'resources', 'app', filename) : null
    ].filter(Boolean);

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

// GET /api/system/legal - Return raw content of EULA.md and LICENSE.md directly from filesystem
router.get('/legal', (req, res) => {
    try {
        const eulaPath = findLegalDocument('EULA.md');
        const licensePath = findLegalDocument('LICENSE.md');

        const eula = eulaPath ? fs.readFileSync(eulaPath, 'utf8') : '# EULA Not Found\n\nUnable to locate `EULA.md` on this installation.';
        const license = licensePath ? fs.readFileSync(licensePath, 'utf8') : '# LICENSE Not Found\n\nUnable to locate `LICENSE.md` on this installation.';

        res.json({
            success: true,
            documents: {
                eula,
                license
            },
            paths: {
                eula: eulaPath,
                license: licensePath
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/system/license/activate - Activate/install a new license key
router.post('/license/activate', async (req, res) => {
    try {
        const { licenseKey } = req.body;
        if (!licenseKey) {
            return res.status(400).json({ success: false, error: 'License key content is required' });
        }
        const result = activateLicense(licenseKey);
        res.json({
            success: true,
            message: result.message,
            payload: result.payload,
            machineCode: result.machineCode
        });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// GET /api/system/status - Overview of system health, DB connection, and sync state (Admin only)
router.get('/status', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const dbStatus = getStatus();
        let syncState = null;
        if (dbStatus.isConnected) {
            try {
                syncState = await SyncState.findOne({ key: 'global_sync' });
            } catch (e) {
                // Ignore sync state query error if DB is unstable
            }
        }
        const scannerStatus = scannerService.getStatus();

        res.json({
            success: true,
            database: dbStatus,
            sync: {
                watermark: syncState ? syncState.lastSyncedClosedAt : null,
                lastRun: syncState ? syncState.lastSyncRunAt : null,
                totalSyncedBoxes: syncState ? syncState.totalSyncedBoxes : 0
            },
            scanner: scannerStatus,
            serverTime: new Date()
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/system/db-test - Test connection parameters without persisting (Admin only)
router.post('/db-test', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { mongoUri } = req.body;
        if (!mongoUri) {
            return res.status(400).json({ success: false, error: 'MongoDB URI is required' });
        }
        const result = await testConnection(mongoUri);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/system/db-config - Save new DB parameters & reconnect
router.post('/db-config', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { mongoUri } = req.body;
        if (!mongoUri) {
            return res.status(400).json({ success: false, error: 'MongoDB URI is required' });
        }

        const testRes = await testConnection(mongoUri);
        if (!testRes.success) {
            return res.status(400).json({ success: false, error: `Connection test failed: ${testRes.message}` });
        }

        // Update encrypted config.enc and .env if present
        try {
            updateConfigValue('MONGO_URI', mongoUri);
        } catch (e) {
            console.warn('[CONFIG] Could not update config.enc:', e.message);
        }

        const envPath = path.join(__dirname, '../../.env');
        if (fs.existsSync(envPath)) {
            let envContent = fs.readFileSync(envPath, 'utf8');
            if (envContent.includes('MONGO_URI=')) {
                envContent = envContent.replace(/MONGO_URI=.*/g, `MONGO_URI=${mongoUri}`);
            } else {
                envContent += `\nMONGO_URI=${mongoUri}`;
            }
            fs.writeFileSync(envPath, envContent, 'utf8');
        }

        // Reconnect Mongoose
        await connectDB(mongoUri);

        // Save in SystemSettings now that connection is active
        try {
            await SystemSettings.findOneAndUpdate(
                { key: 'global_settings' },
                { $set: { mongoUri } },
                { upsert: true }
            );
        } catch (settingsErr) {
            console.warn('[DB RECONNECT] Could not persist settings to collection:', settingsErr.message);
        }

        // Initialize admin account and sync worker for newly connected database
        try {
            const { autoSeedAdmin } = require('../services/authService');
            const { startSyncWorker } = require('../services/syncService');
            await autoSeedAdmin();
            startSyncWorker(parseInt(process.env.SYNC_INTERVAL_MS || '300000', 10));
        } catch (initErr) {
            console.warn('[DB RECONNECT] Post-connect service init warning:', initErr.message);
        }

        res.json({
            success: true,
            message: 'Database configuration updated and reconnected successfully!',
            diagnostics: testRes
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/system/com-ports - List available COM ports
router.get('/com-ports', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const ports = await scannerService.listAvailablePorts();
        res.json({ success: true, ports });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/system/com-config - Reconfigure scanner COM port with full industrial parameters
router.post('/com-config', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { port, baudRate, dataBits, stopBits, parity, delimiter, rtscts } = req.body;
        const configOptions = {
            port,
            baudRate: parseInt(baudRate, 10) || 9600,
            dataBits: parseInt(dataBits, 10) || 8,
            stopBits: parseFloat(stopBits) || 1,
            parity: parity || 'none',
            delimiter: delimiter || '\r\n',
            rtscts: !!rtscts
        };
        
        const connResult = await scannerService.connect(configOptions);

        if (getStatus().isConnected) {
            try {
                await SystemSettings.findOneAndUpdate(
                    { key: 'global_settings' },
                    { $set: { comPort: port, comBaudRate: configOptions.baudRate, comDataBits: configOptions.dataBits, comStopBits: configOptions.stopBits, comParity: configOptions.parity, comDelimiter: configOptions.delimiter } },
                    { upsert: true }
                );
            } catch (e) {
                console.warn('[COM CONFIG] Could not persist settings to collection:', e.message);
            }
        }

        try {
            updateConfigValue('COM_PORT', port);
            updateConfigValue('COM_BAUD_RATE', configOptions.baudRate);
            updateConfigValue('COM_DATA_BITS', configOptions.dataBits);
            updateConfigValue('COM_PARITY', configOptions.parity);
            updateConfigValue('COM_STOP_BITS', configOptions.stopBits);
            updateConfigValue('COM_DELIMITER', delimiter || 'CRLF');

            const envPath = path.join(process.cwd(), '.env');
            if (fs.existsSync(envPath)) {
                let envText = fs.readFileSync(envPath, 'utf8');
                const updates = {
                    COM_PORT: port,
                    COM_BAUD_RATE: configOptions.baudRate,
                    COM_DATA_BITS: configOptions.dataBits,
                    COM_PARITY: configOptions.parity,
                    COM_STOP_BITS: configOptions.stopBits,
                    COM_DELIMITER: delimiter || 'CRLF'
                };
                for (const [k, v] of Object.entries(updates)) {
                    const regex = new RegExp(`^${k}=.*$`, 'm');
                    if (regex.test(envText)) {
                        envText = envText.replace(regex, `${k}=${v}`);
                    } else {
                        envText += `\n${k}=${v}`;
                    }
                }
                fs.writeFileSync(envPath, envText.trim() + '\n', 'utf8');
            }
        } catch (e) {
            console.warn('[COM CONFIG] Could not persist to config.enc/.env:', e.message);
        }

        if (connResult && connResult.isConnected) {
            res.json({
                success: true,
                isConnected: true,
                message: `Scanner successfully connected on ${port} [${configOptions.baudRate}-${configOptions.dataBits}-${configOptions.parity.toUpperCase()[0]}-${configOptions.stopBits}].`
            });
        } else {
            const errDetail = (connResult && connResult.error) ? connResult.error : 'Port hardware unavailable';
            res.status(400).json({
                success: false,
                isConnected: false,
                error: `Failed to open ${port}: ${errDetail}`,
                message: `Failed to open ${port}: ${errDetail}`
            });
        }
    } catch (err) {
        res.status(500).json({ success: false, isConnected: false, error: err.message, message: err.message });
    }
});

// POST /api/system/simulate-scan - Trigger simulated barcode scan event
router.post('/simulate-scan', (req, res) => {
    try {
        const qrData = req.body.qrData || req.body.scannedPayload || req.body.payload;
        if (!qrData) {
            return res.status(400).json({ success: false, error: 'qrData is required' });
        }
        scannerService.simulateScan(qrData);
        res.json({ success: true, message: `Simulated scan fired: ${qrData}` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/system/users - List users (Admin only)
router.get('/users', authenticate, requireRole('admin'), async (req, res) => {
    try {
        if (!getStatus().isConnected) {
            return res.json({ success: true, users: [] });
        }
        const users = await DispatchUser.find().select('-passwordHash').sort({ createdAt: -1 });
        res.json({ success: true, users });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/system/users - Create user (Admin only, hard limit: 10 max)
router.post('/users', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const totalUsers = await DispatchUser.countDocuments();
        if (totalUsers >= 10) {
            return res.status(403).json({
                success: false,
                error: 'Terminal user limit reached. A maximum of 10 users can exist on this terminal.'
            });
        }
        const { username, password, role, fullName } = req.body;
        const authService = require('../services/authService');
        const user = await authService.createUser({ username, password, role, fullName });
        res.json({ success: true, user });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// PUT /api/system/users/:id - Edit an account (Admin only)
router.put('/users/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { fullName, role, active } = req.body;
        const user = await DispatchUser.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        const isSelf = req.user && (
            (req.user.id && req.user.id.toString() === req.params.id) ||
            (req.user._id && req.user._id.toString() === req.params.id)
        );

        if (isSelf) {
            if (role && role !== 'admin') {
                return res.status(400).json({ success: false, error: 'Cannot demote your own Administrator account.' });
            }
            if (active === false) {
                return res.status(400).json({ success: false, error: 'Cannot deactivate your own active Administrator account.' });
            }
        }

        if (user.role === 'admin' && (role && role !== 'admin' || active === false)) {
            const adminCount = await DispatchUser.countDocuments({ role: 'admin', active: true });
            if (adminCount <= 1) {
                return res.status(400).json({ success: false, error: 'Cannot demote or deactivate the sole active Administrator account on the terminal.' });
            }
        }

        if (fullName !== undefined && fullName.trim()) user.fullName = fullName.trim();
        if (role !== undefined && ['operator', 'supervisor', 'manager', 'admin'].includes(role.toLowerCase())) {
            user.role = role.toLowerCase();
        }
        if (active !== undefined) {
            user.active = Boolean(active);
        }

        await user.save();
        res.json({
            success: true,
            message: `User '${user.username}' successfully updated.`,
            user: {
                id: user._id,
                username: user.username,
                fullName: user.fullName,
                role: user.role,
                active: user.active
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/system/users/:id/toggle-active - Toggle user active status (Admin only)
router.patch('/users/:id/toggle-active', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const user = await DispatchUser.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        const isSelf = req.user && (
            (req.user.id && req.user.id.toString() === req.params.id) ||
            (req.user._id && req.user._id.toString() === req.params.id)
        );

        if (isSelf && user.active) {
            return res.status(400).json({ success: false, error: 'Cannot deactivate your own active Administrator account.' });
        }

        if (user.role === 'admin' && user.active) {
            const adminCount = await DispatchUser.countDocuments({ role: 'admin', active: true });
            if (adminCount <= 1) {
                return res.status(400).json({ success: false, error: 'Cannot deactivate the sole active Administrator account on the terminal.' });
            }
        }

        user.active = !user.active;
        await user.save();

        res.json({
            success: true,
            active: user.active,
            message: user.active ? `User '${user.username}' activated.` : `User '${user.username}' deactivated.`
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/system/users/:id - Delete an account (Admin only)
router.delete('/users/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const user = await DispatchUser.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        const isSelf = req.user && (
            (req.user.id && req.user.id.toString() === req.params.id) ||
            (req.user._id && req.user._id.toString() === req.params.id)
        );

        if (isSelf) {
            return res.status(400).json({ success: false, error: 'Cannot delete your own active administrator account.' });
        }

        if (user.role === 'admin') {
            const adminCount = await DispatchUser.countDocuments({ role: 'admin' });
            if (adminCount <= 1) {
                return res.status(400).json({ success: false, error: 'Cannot delete the sole Administrator account on the terminal.' });
            }
        }

        await DispatchUser.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: `User account '${user.username}' successfully deleted.` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/system/users/:id/reset-password - Reset user password (Admin only)
router.post('/users/:id/reset-password', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long' });
        }

        const user = await DispatchUser.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        const salt = await bcrypt.genSalt(10);
        user.passwordHash = await bcrypt.hash(newPassword, salt);
        user.mustChangePassword = false;
        await user.save();

        res.json({ success: true, message: `Password reset successfully for ${user.username}` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/system/license - Retrieve current machine code and license status
router.get('/license', authenticate, (req, res) => {
    try {
        const machineCode = getMachineFingerprint();
        const licenseCandidates = [
            path.join(process.cwd(), 'license.key'),
            path.join(__dirname, '../../license.key'),
            path.join(__dirname, '../license.key')
        ];
        const keyPath = licenseCandidates.find(p => fs.existsSync(p));

        if (!keyPath) {
            return res.json({
                success: true,
                licensed: false,
                machineCode,
                message: 'No license key installed on this system'
            });
        }

        const verification = validateLicense(keyPath);
        res.json({
            success: true,
            licensed: verification.valid,
            machineCode,
            details: verification.valid ? verification.payload : null,
            error: verification.valid ? null : verification.error,
            message: verification.message || verification.error
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/system/license - Install/Activate a new license key
router.post('/license', authenticate, requireRole('admin'), (req, res) => {
    try {
        const { licenseKey } = req.body;
        if (!licenseKey) {
            return res.status(400).json({ success: false, error: 'License key payload is required' });
        }

        const activation = activateLicense(licenseKey, process.cwd());
        res.json({
            success: true,
            message: 'License key successfully activated and saved.',
            details: activation.payload
        });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

const DEFAULT_HOLD_REASONS = [
    'Visual Quality Inspection',
    'Packaging / Label Defect',
    'Lab Testing Pending',
    'Dimensional Tolerance Check',
    'Supervisor Discretion'
];

const DEFAULT_REJECT_REASONS = [
    'Damaged QR / Barcode Sticker',
    'Defective Part Inside Box',
    'Box Packaging Crushed',
    'Quantity Mismatch',
    'Laser Marking Illegible',
    'Tape Seal Damaged'
];

// GET /api/system/reasons - Retrieve quality hold and rejection reason lists
router.get('/reasons', authenticate, async (req, res) => {
    try {
        let settings = await SystemSettings.findOne({ key: 'global_settings' });
        if (!settings) {
            settings = await SystemSettings.create({
                key: 'global_settings',
                holdReasons: DEFAULT_HOLD_REASONS,
                rejectionReasons: DEFAULT_REJECT_REASONS
            });
        }

        const holdReasons = (settings.holdReasons && settings.holdReasons.length > 0)
            ? settings.holdReasons
            : DEFAULT_HOLD_REASONS;

        const rejectionReasons = (settings.rejectionReasons && settings.rejectionReasons.length > 0)
            ? settings.rejectionReasons
            : DEFAULT_REJECT_REASONS;

        res.json({
            success: true,
            holdReasons,
            rejectionReasons
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/system/reasons - Update hold or rejection reasons (Admin only)
router.post('/reasons', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { holdReasons, rejectionReasons } = req.body;

        let settings = await SystemSettings.findOne({ key: 'global_settings' });
        if (!settings) {
            settings = new SystemSettings({ key: 'global_settings' });
        }

        if (Array.isArray(holdReasons)) {
            settings.holdReasons = holdReasons.map(r => String(r).trim()).filter(Boolean);
        }

        if (Array.isArray(rejectionReasons)) {
            settings.rejectionReasons = rejectionReasons.map(r => String(r).trim()).filter(Boolean);
        }

        await settings.save();

        res.json({
            success: true,
            message: 'Quality audit reasons successfully updated',
            holdReasons: settings.holdReasons,
            rejectionReasons: settings.rejectionReasons
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
