// src/models/ReadOnlySchemas.js
// Read-only schemas for ProductModel and Batch from the existing production database (plc_sticker)
const mongoose = require('mongoose');

const productModelSchema = new mongoose.Schema({
    modelId: { type: String, required: true, unique: true },
    modelName: { type: String, required: true },
    batchSize: { type: Number, required: true },
    supplierCode: { type: String, required: true },
    internalPartId: { type: String, required: true },
    customerPartNo: { type: String, required: true },
    productRevNo: { type: String, required: true },
    softwareRevNo: { type: String, required: true },
    customerName: { type: String, required: true },
    logoText: { type: String, default: '' },
    serialPrnTemplate: { type: String, default: '' },
    batchPrnTemplate: { type: String, default: '' },
    active: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
}, {
    collection: 'productmodels'
});

// Guard against accidental writes/mutations to production product models
productModelSchema.pre('save', function(next) {
    next(new Error('READ_ONLY: Cannot modify production productmodels collection'));
});

const batchSchema = new mongoose.Schema({
    batchNumber: { type: Number },              // assigned when batch closes
    machineNo: { type: Number, required: true },
    modelId: { type: String, required: true },
    shiftCode: { type: String },                // set on completion
    batchDate: { type: String },                // YYYY.MM.DD — set on completion
    batchSize: { type: Number, required: true },
    completedCount: { type: Number, default: 0 },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    serialNumbers: [{ type: String }],
    startedAt: { type: Date, default: Date.now },
    closedAt: { type: Date },
    batchPrinted: { type: Boolean, default: false },
    batchQrData: { type: String }               // full batch QR string, set on completion
}, {
    collection: 'batches'
});

// Guard against accidental writes/mutations to production batches
batchSchema.pre('save', function(next) {
    next(new Error('READ_ONLY: Cannot modify production batches collection'));
});

// Register models safely if not already compiled
const ProductModel = mongoose.models.ProductModel || mongoose.model('ProductModel', productModelSchema);
const Batch = mongoose.models.Batch || mongoose.model('Batch', batchSchema);

module.exports = {
    ProductModel,
    Batch
};
