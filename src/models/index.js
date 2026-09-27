// src/models/index.js
const { ProductModel, Batch } = require('./ReadOnlySchemas');
const DispatchBox = require('./DispatchBox');
const DispatchTransaction = require('./DispatchTransaction');
const DispatchUser = require('./DispatchUser');
const BoxLifecycleEvent = require('./BoxLifecycleEvent');
const SyncState = require('./SyncState');
const IdCounter = require('./IdCounter');
const SystemSettings = require('./SystemSettings');

module.exports = {
    // Read-only production models
    ProductModel,
    Batch,
    // Dispatch system models
    DispatchBox,
    DispatchTransaction,
    DispatchUser,
    BoxLifecycleEvent,
    SyncState,
    IdCounter,
    SystemSettings
};
