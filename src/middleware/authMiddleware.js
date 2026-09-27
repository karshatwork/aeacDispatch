// src/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const DispatchUser = require('../models/DispatchUser');

const JWT_SECRET = process.env.JWT_SECRET || 'aeac_dispatch_secret_key_super_secure_2026';

const ROLE_HIERARCHY = {
    operator: 1,
    supervisor: 2,
    manager: 3,
    admin: 4
};

/**
 * Middleware to verify JWT session token
 */
async function authenticate(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Authentication required. Please login.' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const user = await DispatchUser.findById(decoded.userId);
        if (!user || !user.active) {
            return res.status(401).json({ success: false, error: 'User session invalid or deactivated' });
        }

        req.user = {
            id: user._id,
            username: user.username,
            role: user.role,
            fullName: user.fullName
        };
        next();
    } catch (err) {
        return res.status(401).json({ success: false, error: 'Invalid or expired session token. Please relogin.' });
    }
}

/**
 * Middleware to enforce minimum role requirement
 * e.g. requireRole('supervisor') allows supervisor, manager, admin.
 */
function requireRole(minRole) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        const userLevel = ROLE_HIERARCHY[req.user.role] || 0;
        const requiredLevel = ROLE_HIERARCHY[minRole] || 0;

        if (userLevel < requiredLevel) {
            return res.status(403).json({
                success: false,
                error: `Access denied: Action requires role '${minRole}' or higher. Your role: '${req.user.role}'`
            });
        }
        next();
    };
}

module.exports = {
    authenticate,
    requireRole
};
