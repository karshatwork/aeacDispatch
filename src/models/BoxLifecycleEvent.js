// src/models/BoxLifecycleEvent.js
const mongoose = require('mongoose');

const boxLifecycleEventSchema = new mongoose.Schema({
    boxId: { type: mongoose.Schema.Types.ObjectId, ref: 'DispatchBox', required: true, index: true },
    batchNumber: { type: Number, required: true, index: true },
    modelId: { type: String, required: true, index: true },
    eventType: {
        type: String,
        enum: [
            'BOX_INGESTED',
            'BOX_HELD',
            'BOX_HOLD_RELEASED',
            'BOX_REJECTED',
            'BOX_REJECT_REOPENED',
            'BOX_ALLOCATED',
            'BOX_SCANNED',
            'BOX_DISPATCHED'
        ],
        required: true,
        index: true
    },
    referenceId: { type: String, index: true }, // e.g. DSP..., HLD..., REJ...
    performedBy: { type: String, required: true },
    userRole: { type: String, required: true },
    timestamp: { type: Date, default: Date.now, index: true },
    reason: { type: String },
    remarks: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed }
}, {
    collection: 'dispatch_box_events'
});

// Index for chronological timeline retrieval:
boxLifecycleEventSchema.index({ boxId: 1, timestamp: 1 });
boxLifecycleEventSchema.index({ batchNumber: 1, timestamp: 1 });

const BoxLifecycleEvent = mongoose.models.BoxLifecycleEvent || mongoose.model('BoxLifecycleEvent', boxLifecycleEventSchema);

module.exports = BoxLifecycleEvent;
