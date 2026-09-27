// src/models/DispatchUser.js
const mongoose = require('mongoose');

const dispatchUserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: {
        type: String,
        enum: ['operator', 'supervisor', 'manager', 'admin'],
        default: 'operator',
        required: true
    },
    fullName: { type: String, required: true },
    active: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    lastLoginAt: { type: Date }
}, {
    timestamps: true,
    collection: 'dispatch_users'
});

dispatchUserSchema.pre('save', async function (next) {
    if (this.isNew) {
        const count = await this.constructor.countDocuments();
        if (count >= 10) {
            const err = new Error('Terminal user limit reached. A maximum of 10 users can exist on this terminal.');
            err.code = 'USER_LIMIT_EXCEEDED';
            return next(err);
        }
    }
    next();
});

const DispatchUser = mongoose.models.DispatchUser || mongoose.model('DispatchUser', dispatchUserSchema);

module.exports = DispatchUser;
