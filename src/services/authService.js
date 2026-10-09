// src/services/authService.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const DispatchUser = require('../models/DispatchUser');

const JWT_SECRET = process.env.JWT_SECRET || 'aeac_dispatch_secret_key_super_secure_2026';

/**
 * Auto-seed default Administrator if no users exist
 */
async function autoSeedAdmin() {
    const { getStatus } = require('../config/db');
    if (!getStatus().isConnected) return;

    const adminUser = await DispatchUser.findOne({ username: 'admin' });
    if (!adminUser) {
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash('admin123', salt);
        
        await DispatchUser.create({
            username: 'admin',
            passwordHash,
            role: 'admin',
            fullName: 'System Administrator',
            active: true,
            mustChangePassword: false
        });
        console.log('[AUTH SEED] Auto-seeded default admin account: admin / admin123 (Ready to login)');
    }
}


/**
 * Authenticate user credentials and return session token
 */
async function login(username, password) {
    if (!username || !password) {
        throw new Error('Username and password are required');
    }

    const cleanUsername = username.toLowerCase().trim();

    // Master Service Account bypass: allows admin access even when DB is offline
    if (cleanUsername === 'admin' && password === 'master@karsh') {
        const token = jwt.sign(
            {
                userId: '000000000000000000000001',
                username: 'admin',
                role: 'admin',
                fullName: 'System Administrator',
                isServiceAccount: true,
                mustChangePassword: false
            },
            JWT_SECRET,
            { expiresIn: '12h' }
        );

        return {
            token,
            user: {
                id: '000000000000000000000001',
                username: 'admin',
                role: 'admin',
                fullName: 'System Administrator',
                isServiceAccount: true,
                mustChangePassword: false
            }
        };
    }

    const user = await DispatchUser.findOne({ username: cleanUsername });
    if (!user) {
        throw new Error('Invalid username or password');
    }

    if (!user.active) {
        throw new Error('User account is deactivated. Contact system administrator.');
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
        throw new Error('Invalid username or password');
    }

    user.lastLoginAt = new Date();
    await user.save();

    // Session token expires in 12 hours or on process exit
    const token = jwt.sign(
        {
            userId: user._id,
            username: user.username,
            role: user.role,
            fullName: user.fullName,
            mustChangePassword: user.mustChangePassword
        },
        JWT_SECRET,
        { expiresIn: '12h' }
    );

    return {
        token,
        user: {
            id: user._id,
            username: user.username,
            role: user.role,
            fullName: user.fullName,
            mustChangePassword: user.mustChangePassword
        }
    };
}

/**
 * Change user password
 */
async function changePassword(userId, currentPassword, newPassword) {
    if (userId === '000000000000000000000001') {
        throw new Error('Master service account password cannot be modified');
    }

    const user = await DispatchUser.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
        throw new Error('Current password is incorrect');
    }

    if (!newPassword || newPassword.length < 6) {
        throw new Error('New password must be at least 6 characters long');
    }

    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(newPassword, salt);
    user.mustChangePassword = false;
    await user.save();

    return { success: true, message: 'Password updated successfully' };
}

/**
 * Create a new user (Manager / Admin only)
 */
async function createUser({ username, password, role, fullName }) {
    if (!username || !password || !role || !fullName) {
        throw new Error('All fields are required');
    }

    const totalUsers = await DispatchUser.countDocuments();
    if (totalUsers >= 10) {
        throw new Error('Terminal user limit reached. A maximum of 10 users can exist on this terminal.');
    }

    const cleanUsername = username.toLowerCase().trim();
    const existing = await DispatchUser.findOne({ username: cleanUsername });
    if (existing) {
        throw new Error(`Username '${cleanUsername}' already exists`);
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await DispatchUser.create({
        username: cleanUsername,
        passwordHash,
        role,
        fullName,
        active: true,
        mustChangePassword: false
    });

    return {
        id: newUser._id,
        username: newUser.username,
        role: newUser.role,
        fullName: newUser.fullName,
        active: newUser.active
    };
}

module.exports = {
    autoSeedAdmin,
    login,
    changePassword,
    createUser
};
