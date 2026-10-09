#!/usr/bin/env node
/**
 * scripts/clear-local-db.js
 * Wipes all test batches, product models, dispatch boxes, transactions,
 * lifecycle events, and sync state from the local MongoDB database (plc_sticker).
 */

const mongoose = require('mongoose');

const MONGO_URI = 'mongodb://127.0.0.1:27017/plc_sticker';

async function clearLocalDb() {
    console.log(`\n================================================================`);
    console.log(` 🧹 RECORDKEEPER DISPATCH - LOCAL DATABASE PURGE TOOL           `);
    console.log(`================================================================`);
    console.log(`Connecting to local MongoDB: ${MONGO_URI}...`);

    try {
        const conn = await mongoose.createConnection(MONGO_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();

        const db = conn.db;

        console.log('\n[PURGE] Clearing all collections in local plc_sticker database...');

        const resBatches = await db.collection('batches').deleteMany({});
        const resModels = await db.collection('productmodels').deleteMany({});
        const resBoxes = await db.collection('dispatch_boxes').deleteMany({});
        const resTxs = await db.collection('dispatch_transactions').deleteMany({});
        const resEvents = await db.collection('dispatch_box_events').deleteMany({});
        const resSync = await db.collection('dispatch_sync_state').deleteMany({});

        console.log(` - Deleted ${resBatches.deletedCount} upstream batches`);
        console.log(` - Deleted ${resModels.deletedCount} product models`);
        console.log(` - Deleted ${resBoxes.deletedCount} dispatch boxes`);
        console.log(` - Deleted ${resTxs.deletedCount} dispatch transactions`);
        console.log(` - Deleted ${resEvents.deletedCount} lifecycle audit events`);
        console.log(` - Reset ${resSync.deletedCount} sync state watermarks`);

        console.log('\n✔ Local database wiped clean successfully!');
        console.log('================================================================\n');

        await conn.close();
        process.exit(0);
    } catch (err) {
        console.error('\n✖ Failed to clear database:', err.message);
        process.exit(1);
    }
}

clearLocalDb();
