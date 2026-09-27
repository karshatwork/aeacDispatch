// src/models/DispatchBox.js
const mongoose = require('mongoose');

const dispatchBoxSchema = new mongoose.Schema({
    batchId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
    batchNumber: { type: Number, required: true, index: true },
    modelId: { type: String, required: true, index: true },
    machineNo: { type: Number, required: true },
    shiftCode: { type: String, required: true },
    batchDate: { type: String, required: true },
    batchSize: { type: Number, required: true },
    completedCount: { type: Number, required: true },
    serialNumbers: [{ type: String }],
    batchQrData: { type: String, required: true },
    closedAt: { type: Date, required: true, index: true },
    
    // Status is strictly one of 4 states:
    status: {
        type: String,
        enum: ['available', 'hold', 'rejected', 'dispatched'],
        default: 'available',
        index: true
    },
    
    // Active / Historical Hold information
    holdId: { type: String },          // HLDYYYYMMDD0001
    holdReason: { type: String },
    holdRemarks: { type: String },
    heldBy: { type: String },
    heldAt: { type: Date },
    holdReleasedBy: { type: String },
    holdReleasedAt: { type: Date },
    
    // Active / Historical Rejection information
    rejectionId: { type: String },     // REJYYYYMMDD0001
    rejectionReason: { type: String },
    rejectionRemarks: { type: String },
    rejectedBy: { type: String },
    rejectedAt: { type: Date },
    reopenedBy: { type: String },      // Strictly Manager/Admin
    reopenedAt: { type: Date },
    reopenRemarks: { type: String },
    
    // Dispatch completion info
    dispatchId: { type: String, index: true }, // DSPYYYYMMDD0001
    dispatchedBy: { type: String },
    dispatchedAt: { type: Date }
}, {
    timestamps: true,
    collection: 'dispatch_boxes'
});

// Composite index for ultra-fast strict FIFO allocation:
dispatchBoxSchema.index({ modelId: 1, status: 1, closedAt: 1 });

const DispatchBox = mongoose.models.DispatchBox || mongoose.model('DispatchBox', dispatchBoxSchema);

module.exports = DispatchBox;
