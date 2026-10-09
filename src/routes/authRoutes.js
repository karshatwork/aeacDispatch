// src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const { authenticate } = require('../middleware/authMiddleware');
const { autoCleanupOpenDispatches } = require('../services/fifoService');

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await authService.login(username, password);

        // Auto-cleanup any dangling in_progress dispatches for this user or older than 30 mins (if DB is online)
        try {
            await autoCleanupOpenDispatches({
                operatorUsername: result.user ? result.user.username : username,
                reason: `Session closed upon fresh login by ${username}`
            });
        } catch (cleanupErr) {
            console.warn('[LOGIN CLEANUP NOTICE]', cleanupErr.message);
        }

        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res) => {
    try {
        const username = req.user && req.user.username;
        if (username) {
            try {
                await autoCleanupOpenDispatches({
                    operatorUsername: username,
                    reason: `Session closed upon operator logout (${username})`
                });
            } catch (cleanupErr) {
                console.warn('[LOGOUT CLEANUP NOTICE]', cleanupErr.message);
            }
        }
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/auth/change-password
router.post('/change-password', authenticate, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const result = await authService.changePassword(req.user.id, currentPassword, newPassword);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// GET /api/auth/profile
router.get('/profile', authenticate, async (req, res) => {
    res.json({ success: true, user: req.user });
});

module.exports = router;

