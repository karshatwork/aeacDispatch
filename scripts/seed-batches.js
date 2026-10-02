#!/usr/bin/env node
/**
 * scripts/seed-batches.js
 * 
 * Seeds new, fresh, available production boxes for all active product models.
 * Used for development, testing FIFO dispatch flows, and restoring stock.
 * 
 * Usage:
 *   npm run seed:batches              (seeds 10 boxes per model by default)
 *   npm run seed:batches -- 5         (seeds 5 boxes per model)
 *   npm run seed:batches -- --count 20
 *   npm run seed:batches -- --model M001 --count 10
 */

const path = require('path');
const mongoose = require('mongoose');

// Initialize encrypted config environment
try {
    const { initEnvironment } = require('../src/utils/cryptoConfig');
    initEnvironment();
} catch (e) {
    require('dotenv').config({ path: path.join(__dirname, '../.env') });
}

const {
    ProductModel,
    DispatchBox,
    BoxLifecycleEvent,
    SyncState
} = require('../src/models');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/plc_sticker';

// ANSI Colors for clean terminal UI
const C = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m'
};

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    let count = 10;
    let model = null;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--count' || arg === '-c' || arg === '-q' || arg === '--qty') {
            if (args[i + 1] && !isNaN(parseInt(args[i + 1], 10))) {
                count = parseInt(args[i + 1], 10);
                i++;
            }
        } else if (arg === '--model' || arg === '-m') {
            if (args[i + 1]) {
                model = args[i + 1].trim().toUpperCase();
                i++;
            }
        } else if (!isNaN(parseInt(arg, 10)) && i === 0) {
            count = parseInt(arg, 10);
        }
    }

    if (count <= 0) count = 10;
    return { count, model };
}

// Fallback baseline models if database has none
const DEFAULT_MODELS = [
    {
        modelId: 'M001',
        modelName: 'MOD-ALU-HOUSING',
        batchSize: 20,
        supplierCode: 'S1042',
        internalPartId: 'IP-HOUSING-01',
        customerPartNo: '0303CAL00111N',
        productRevNo: 'REV-A',
        softwareRevNo: 'SW-1.4',
        customerName: 'Mahindra & Mahindra Powertrain',
        logoText: 'MAHINDRA',
        serialPrnTemplate: 'serial_template.prn',
        batchPrnTemplate: 'batch_template.prn',
        active: true
    },
    {
        modelId: 'M002',
        modelName: 'MOD-STEEL-FLANGE',
        batchSize: 50,
        supplierCode: 'S1042',
        internalPartId: 'IP-FLANGE-02',
        customerPartNo: '0303CSL00222N',
        productRevNo: 'REV-B',
        softwareRevNo: 'SW-1.4',
        customerName: 'Mahindra & Mahindra Powertrain',
        logoText: 'MAHINDRA',
        serialPrnTemplate: 'serial_template.prn',
        batchPrnTemplate: 'batch_template.prn',
        active: true
    },
    {
        modelId: 'M003',
        modelName: 'MOD-GEAR-PINION',
        batchSize: 25,
        supplierCode: 'S1042',
        internalPartId: 'IP-PINION-03',
        customerPartNo: 'TM-9821-GP-03',
        productRevNo: 'REV-C',
        softwareRevNo: 'SW-2.0',
        customerName: 'Tata Motors Commercial Vehicles',
        logoText: 'TATA',
        serialPrnTemplate: 'serial_template.prn',
        batchPrnTemplate: 'batch_template.prn',
        active: true
    },
    {
        modelId: 'M004',
        modelName: 'MOD-CLUTCH-COLLAR',
        batchSize: 30,
        supplierCode: 'S1042',
        internalPartId: 'IP-COLLAR-04',
        customerPartNo: 'BGL-CC-4004',
        productRevNo: 'REV-A',
        softwareRevNo: 'SW-1.1',
        customerName: 'BGL Industrial Transmission',
        logoText: 'BGL',
        serialPrnTemplate: 'serial_template.prn',
        batchPrnTemplate: 'batch_template.prn',
        active: true
    }
];

async function ensureProductModels(db) {
    let models = await ProductModel.find({ active: true }).lean();
    if (!models || models.length === 0) {
        console.log(`${C.yellow}ℹ No active models found in database. Seeding standard product models...${C.reset}`);
        for (const m of DEFAULT_MODELS) {
            await db.collection('productmodels').updateOne(
                { modelId: m.modelId },
                { $set: m },
                { upsert: true }
            );
        }
        models = await ProductModel.find({ active: true }).lean();
    }
    return models;
}

async function getNextBatchNumber(db) {
    const [latestUpstream, latestDispatch] = await Promise.all([
        db.collection('batches').findOne({}, { sort: { batchNumber: -1 }, projection: { batchNumber: 1 } }),
        DispatchBox.findOne().sort({ batchNumber: -1 }).select('batchNumber').lean()
    ]);
    const maxUpstream = latestUpstream ? latestUpstream.batchNumber : 1000;
    const maxDispatch = latestDispatch ? latestDispatch.batchNumber : 1000;
    return Math.max(maxUpstream, maxDispatch) + 1;
}

async function seedBatches() {
    const { count: qtyPerModel, model: targetModel } = parseArgs();

    console.log(`\n${C.bright}${C.cyan}╔════════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
    console.log(`${C.bright}${C.cyan}║             📦 RECORDKEEPER DISPATCH - FRESH BATCHES SEEDER                    ║${C.reset}`);
    console.log(`${C.bright}${C.cyan}╚════════════════════════════════════════════════════════════════════════════════╝${C.reset}`);
    console.log(`${C.dim}Connecting to MongoDB: ${MONGO_URI}...${C.reset}`);

    await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 5000
    });

    const db = mongoose.connection.db;
    let models = await ensureProductModels(db);

    if (targetModel) {
        models = models.filter(m => m.modelId.toUpperCase() === targetModel);
        if (models.length === 0) {
            console.log(`${C.red}✖ Target model '${targetModel}' not found in active product models.${C.reset}`);
            process.exit(1);
        }
    }

    const totalBoxesToCreate = models.length * qtyPerModel;
    console.log(`${C.green}✔ Connected successfully!${C.reset}`);
    console.log(`${C.bright}Target Models:${C.reset} ${models.map(m => m.modelId).join(', ')} (${models.length} models)`);
    console.log(`${C.bright}Quantity Per Model:${C.reset} ${qtyPerModel} fresh available boxes`);
    console.log(`${C.bright}Total Boxes to Seed:${C.reset} ${totalBoxesToCreate} boxes\n`);

    let currentBatchNumber = await getNextBatchNumber(db);
    const startBatchNumber = currentBatchNumber;

    // Chronological spacing: space batches chronologically 2 minutes apart up to now
    const now = Date.now();
    const intervalMs = 2 * 60 * 1000; // 2 minutes between each batch
    const baseStartTime = now - (totalBoxesToCreate * intervalMs);

    let globalBoxIndex = 0;
    const summaryData = [];
    let latestClosedAt = new Date();

    for (const model of models) {
        const batchSize = model.batchSize || 20;
        const modelBatchStart = currentBatchNumber;
        let modelPartsCount = 0;

        const upstreamBatches = [];
        const dispatchBoxes = [];
        const lifecycleEvents = [];

        for (let i = 0; i < qtyPerModel; i++) {
            const batchNum = currentBatchNumber++;
            const boxClosedTime = new Date(baseStartTime + (globalBoxIndex * intervalMs));
            const boxStartTime = new Date(boxClosedTime.getTime() - 45 * 60 * 1000);
            latestClosedAt = boxClosedTime;
            globalBoxIndex++;

            const yyyy = boxClosedTime.getFullYear();
            const mm = String(boxClosedTime.getMonth() + 1).padStart(2, '0');
            const dd = String(boxClosedTime.getDate()).padStart(2, '0');
            const batchDate = `${yyyy}.${mm}.${dd}`;

            const serialNumbers = [];
            for (let s = 1; s <= batchSize; s++) {
                serialNumbers.push(`SN-${model.modelId}-${batchNum}-${String(s).padStart(3, '0')}`);
            }

            const batchQrData = `*DEFAULT|${model.modelId}|${batchNum}*`;
            const boxDocId = new mongoose.Types.ObjectId();
            const upstreamBatchId = new mongoose.Types.ObjectId();

            // 1. Upstream PLC Batch document
            upstreamBatches.push({
                _id: upstreamBatchId,
                batchNumber: batchNum,
                machineNo: 18,
                modelId: model.modelId,
                shiftCode: '1A',
                batchDate,
                batchSize,
                completedCount: batchSize,
                status: 'closed',
                serialNumbers,
                startedAt: boxStartTime,
                closedAt: boxClosedTime,
                batchPrinted: true,
                batchQrData
            });

            // 2. Dispatch Box document (status: available)
            dispatchBoxes.push({
                _id: boxDocId,
                batchId: upstreamBatchId,
                batchNumber: batchNum,
                modelId: model.modelId,
                machineNo: 18,
                shiftCode: '1A',
                batchDate,
                batchSize,
                completedCount: batchSize,
                serialNumbers,
                batchQrData,
                closedAt: boxClosedTime,
                status: 'available'
            });

            // 3. Lifecycle Ingest Audit Event
            lifecycleEvents.push({
                boxId: boxDocId,
                batchNumber: batchNum,
                modelId: model.modelId,
                eventType: 'BOX_INGESTED',
                performedBy: 'SYSTEM_SYNC',
                userRole: 'SYSTEM',
                timestamp: boxClosedTime,
                remarks: `Ingested from Station 18 PLC (closed at ${boxClosedTime.toISOString()})`
            });

            modelPartsCount += batchSize;
        }

        // Insert into collections
        if (upstreamBatches.length > 0) {
            await db.collection('batches').insertMany(upstreamBatches);
        }
        if (dispatchBoxes.length > 0) {
            await DispatchBox.insertMany(dispatchBoxes);
        }
        if (lifecycleEvents.length > 0) {
            await BoxLifecycleEvent.insertMany(lifecycleEvents);
        }

        summaryData.push({
            modelId: model.modelId,
            modelName: model.modelName,
            batchSize,
            boxesAdded: qtyPerModel,
            partsAdded: modelPartsCount,
            batchRange: `BATCH #${modelBatchStart} ➜ #${currentBatchNumber - 1}`
        });
    }

    // Advance sync watermark so sync service stays in harmony
    await SyncState.updateOne(
        { key: 'global_sync' },
        {
            $set: {
                lastSyncedClosedAt: latestClosedAt,
                lastBatchNumber: currentBatchNumber - 1,
                isInitialized: true
            }
        },
        { upsert: true }
    );

    // Fetch new total available stock counts for verification
    const stockAgg = await DispatchBox.aggregate([
        { $match: { status: 'available' } },
        {
            $group: {
                _id: '$modelId',
                availableBoxes: { $sum: 1 },
                availableParts: { $sum: '$completedCount' }
            }
        }
    ]);
    const stockMap = {};
    stockAgg.forEach(s => { stockMap[s._id] = s; });

    console.log(`${C.bright}${C.green}════════════════════════════════════════════════════════════════════════════════${C.reset}`);
    console.log(`${C.bright}${C.green}✔ SUCCESS: Successfully seeded ${totalBoxesToCreate} fresh available boxes!${C.reset}`);
    console.log(`${C.bright}${C.green}════════════════════════════════════════════════════════════════════════════════${C.reset}\n`);

    console.table(summaryData.map(s => ({
        'Model ID': s.modelId,
        'Model Description': s.modelName,
        'Batch Size': `${s.batchSize} pcs`,
        'Boxes Seeded': `+${s.boxesAdded}`,
        'Parts Seeded': `+${s.partsAdded}`,
        'Batch Range': s.batchRange,
        'Total Available Stock': `${stockMap[s.modelId]?.availableBoxes || 0} boxes (${stockMap[s.modelId]?.availableParts || 0} parts)`
    })));

    console.log(`\n${C.cyan}ℹ Global Batch Range:${C.reset} #${startBatchNumber} to #${currentBatchNumber - 1}`);
    console.log(`${C.cyan}ℹ Stock Status:${C.reset} All boxes marked ${C.green}AVAILABLE${C.reset} for immediate FIFO dispatch sessions.`);
    console.log(`${C.dim}Done.${C.reset}\n`);

    await mongoose.disconnect();
    process.exit(0);
}

seedBatches().catch(err => {
    console.error(`${C.red}✖ Failed to seed batches: ${err.message}${C.reset}`);
    console.error(err.stack);
    process.exit(1);
});
