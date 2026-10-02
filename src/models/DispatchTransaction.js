// src/models/DispatchTransaction.js
const mongoose = require('mongoose');

const dispatchTransactionSchema = new mongoose.Schema({
    dispatchId: { type: String, required: true, unique: true, index: true }, // DSPYYYYMMDD0001
    modelId: { type: String, required: true, index: true },
    targetType: { type: String, enum: ['boxes', 'parts'], required: true },
    targetQuantity: { type: Number, required: true },
    
    // Transaction lifecycle state:
    status: {
        type: String,
        enum: ['in_progress', 'completed', 'cancelled', 'stale'],
        default: 'in_progress',
        index: true
    },
    
    // Boxes allocated in strict FIFO order
    allocatedBoxes: [{
        boxId: { type: mongoose.Schema.Types.ObjectId, ref: 'DispatchBox', required: true },
        batchNumber: { type: Number, required: true },
        completedCount: { type: Number, required: true },
        batchQrData: { type: String, required: true },
        closedAt: { type: Date, required: true },
        serialNumbers: [{ type: String }]
    }],
    
    // Boxes verified by scanning so far
    scannedBoxes: [{
        boxId: { type: mongoose.Schema.Types.ObjectId, ref: 'DispatchBox', required: true },
        batchNumber: { type: Number, required: true },
        completedCount: { type: Number, required: true },
        scannedAt: { type: Date, default: Date.now }
    }],
    
    dispatchedBoxCount: { type: Number, default: 0 },
    dispatchedPartCount: { type: Number, default: 0 },
    
    operatorUsername: { type: String, required: true },
    operatorFullName: { type: String, default: '' },
    startedAt: { type: Date, default: Date.now, index: true },
    completedAt: { type: Date },
    cancelledAt: { type: Date },
    cancellationReason: { type: String },
    notes: { type: String }
}, {
    timestamps: true,
    collection: 'dispatch_transactions'
});

const DispatchTransaction = mongoose.models.DispatchTransaction || mongoose.model('DispatchTransaction', dispatchTransactionSchema);

module.exports = DispatchTransaction;
