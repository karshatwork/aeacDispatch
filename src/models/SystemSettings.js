// src/models/SystemSettings.js
const mongoose = require('mongoose');

const systemSettingsSchema = new mongoose.Schema({
    key: { type: String, default: 'global_settings', unique: true },
    mongoUri: { type: String },
    comPort: { type: String, default: 'COM3' },
    comBaudRate: { type: Number, default: 9600 },
    companyName: { type: String, default: 'Elektrosil' },
    customerName: { type: String, default: 'Mahindra' },
    syncIntervalMs: { type: Number, default: 3000 }
}, {
    timestamps: true,
    collection: 'dispatch_settings'
});

const SystemSettings = mongoose.models.SystemSettings || mongoose.model('SystemSettings', systemSettingsSchema);

module.exports = SystemSettings;
