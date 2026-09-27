// src/models/SyncState.js
const mongoose = require('mongoose');

const syncStateSchema = new mongoose.Schema({
    key: { type: String, default: 'global_sync', unique: true },
    lastSyncedClosedAt: { type: Date, required: true },
    lastBatchNumber: { type: Number },
    lastSyncRunAt: { type: Date, default: Date.now },
    totalSyncedBoxes: { type: Number, default: 0 },
    isInitialized: { type: Boolean, default: false }
}, {
    timestamps: true,
    collection: 'dispatch_sync_state'
});

const SyncState = mongoose.models.SyncState || mongoose.model('SyncState', syncStateSchema);

module.exports = SyncState;
