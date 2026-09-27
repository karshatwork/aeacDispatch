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
router.get('/health', (req, res) => {
    const dbStatus = getStatus();
    const scannerStatus = scannerService.getStatus();
    const machineCode = getMachineFingerprint();
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
        scanner: scannerStatus,
        license,
        serverTime: new Date()
    });
});

// GET /api/system/status - Overview of system health, DB connection, and sync state
router.get('/status', authenticate, async (req, res) => {

    try {
        const dbStatus = getStatus();
        const syncState = await SyncState.findOne({ key: 'global_sync' });
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

// POST /api/system/db-test - Test connection parameters without persisting
router.post('/db-test', authenticate, requireRole('manager'), async (req, res) => {
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

        // Save in SystemSettings
        await SystemSettings.findOneAndUpdate(
            { key: 'global_settings' },
            { $set: { mongoUri } },
            { upsert: true }
        );

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
        
        scannerService.connect(configOptions);

        await SystemSettings.findOneAndUpdate(
            { key: 'global_settings' },
            { $set: { comPort: port, comBaudRate: configOptions.baudRate, comDataBits: configOptions.dataBits, comStopBits: configOptions.stopBits, comParity: configOptions.parity, comDelimiter: configOptions.delimiter } },
            { upsert: true }
        );

        try {
            updateConfigValue('COM_PORT', port);
            updateConfigValue('COM_BAUD_RATE', configOptions.baudRate);
        } catch (e) {}

        res.json({
            success: true,
            message: `Scanner reconfigured to ${port} [${configOptions.baudRate}-${configOptions.dataBits}-${configOptions.parity.toUpperCase()[0]}-${configOptions.stopBits}]. Connecting...`
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/system/test-scan - Test wedge simulation
router.post('/test-scan', authenticate, (req, res) => {
    const { qrData } = req.body;
    if (!qrData) return res.status(400).json({ success: false, error: 'QR data required' });
    scannerService.simulateScan(qrData);
    res.json({ success: true, message: `Simulated scan emitted: ${qrData}` });
});

// GET /api/system/users - List users
router.get('/users', authenticate, requireRole('manager'), async (req, res) => {
    try {
        const users = await DispatchUser.find().select('-passwordHash').sort({ createdAt: -1 });
        res.json({ success: true, users });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/system/users - Create user (Hard limit: 10 max)
router.post('/users', authenticate, requireRole('manager'), async (req, res) => {
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

// DELETE /api/system/users/:id - Delete an operator account (Admin only)
router.delete('/users/:id', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const user = await DispatchUser.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        if (req.user && req.user._id && req.user._id.toString() === req.params.id) {
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

// POST /api/system/users/:id/reset-password - Reset user password
router.post('/users/:id/reset-password', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
        }

        const user = await DispatchUser.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        const salt = await bcrypt.genSalt(10);
        user.passwordHash = await bcrypt.hash(newPassword, salt);
        user.mustChangePassword = true;
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

// POST /api/system/seed-dummy-data - Seed rich dummy dataset (available, hold, rejected, historical dispatches)
router.post('/seed-dummy-data', authenticate, async (req, res) => {
    try {
        const mongoose = require('mongoose');
        const dummyDataSeeder = require('../utils/dummyDataSeeder');
        const db = mongoose.connection.db;
        if (!db) {
            return res.status(503).json({ success: false, error: 'Database is not connected' });
        }
        const force = req.body.force !== false; // default true so user can easily reload full dataset
        const result = await dummyDataSeeder.seedAll(db, { force });
        res.json({
            success: true,
            message: `Successfully seeded ${result.modelsCount} models, ${result.boxesCount} boxes (${result.availableCount} available, ${result.holdCount} on hold, ${result.rejectedCount} rejected, ${result.dispatchedCount} dispatched), and ${result.transactionsCount} historical transactions.`,
            stats: result
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
