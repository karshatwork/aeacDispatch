// src/models/IdCounter.js
const mongoose = require('mongoose');

const idCounterSchema = new mongoose.Schema({
    counterKey: { type: String, required: true, unique: true }, // e.g. DSP_20260926
    seq: { type: Number, default: 0 }
}, {
    collection: 'dispatch_id_counters'
});

const IdCounter = mongoose.models.IdCounter || mongoose.model('IdCounter', idCounterSchema);

module.exports = IdCounter;
