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

const DispatchUser = mongoose.models.DispatchUser || mongoose.model('DispatchUser', dispatchUserSchema);

module.exports = DispatchUser;
