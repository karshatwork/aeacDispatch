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

// Support CLI URI or --local overrides before loading encrypted environment
const uriArgIdx = process.argv.findIndex(a => a === '--uri' || a === '-u');
const isLocal = process.argv.includes('--local') || process.argv.includes('-l');
let cliUri = null;
if (uriArgIdx !== -1 && process.argv[uriArgIdx + 1]) {
    cliUri = process.argv[uriArgIdx + 1];
} else if (isLocal) {
    cliUri = 'mongodb://127.0.0.1:27017/plc_sticker';
}

try {
    const { initEnvironment } = require('../src/utils/cryptoConfig');
    initEnvironment();
} catch (e) {
    require('dotenv').config({ path: path.join(__dirname, '../.env') });
}

const MONGO_URI = cliUri || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/plc_sticker';

const {
    ProductModel,
    DispatchBox,
    BoxLifecycleEvent,
    SyncState
} = require('../src/models');

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
    let isDirect = args.includes('--direct');

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
    return { count, model, isDirect };
}

// Authentic production product models matching real plc_sticker database
const DEFAULT_MODELS = [
    {
        modelId: 'M001',
        modelName: 'AE-33.0010.00 - Lear Part',
        batchSize: 60,
        supplierCode: '10156230',
        internalPartId: 'AE-33.0010.00',
        customerPartNo: 'L003388589NCPAA',
        productRevNo: 'Level 4',
        softwareRevNo: 'SW2',
        customerName: 'LEAR Corporation',
        logoText: 'LEAR',
        serialPrnTemplate: 'serial_template.prn',
        batchPrnTemplate: 'batch_template.prn',
        active: true
    },
    {
        modelId: 'M002',
        modelName: 'AE-33.0006.00 - MSKH Part',
        batchSize: 60,
        supplierCode: 'ABH006',
        internalPartId: 'AE-33.0006.00',
        customerPartNo: 'E4MV-24136',
        productRevNo: 'Level 4',
        softwareRevNo: 'SW2',
        customerName: 'MSKH Seatings',
        logoText: 'MSKH',
        serialPrnTemplate: 'serial_template.prn',
        batchPrnTemplate: 'batch_template.prn',
        active: true
    }
];

function generateRealSerials(startOffset, count) {
    const serials = [];
    for (let i = 0; i < count; i++) {
        let n = startOffset + i;
        let c1 = String.fromCharCode(65 + (Math.floor(n / 676) % 26));
        let c2 = String.fromCharCode(65 + (Math.floor(n / 26) % 26));
        let c3 = String.fromCharCode(65 + (n % 26));
        serials.push(`${c1}${c2}${c3}`);
    }
    return serials;
}

async function ensureProductModels(db) {
    for (const m of DEFAULT_MODELS) {
        await db.collection('productmodels').updateOne(
            { modelId: m.modelId },
            { $set: m },
            { upsert: true }
        );
    }
    return ProductModel.find({ active: true }).lean();
}

async function getNextBatchNumber(db) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [latestUpstream, latestDispatch] = await Promise.all([
        db.collection('batches').findOne({ createdAt: { $gte: startOfDay } }, { sort: { batchNumber: -1 }, projection: { batchNumber: 1 } }),
        DispatchBox.findOne({ createdAt: { $gte: startOfDay } }).sort({ batchNumber: -1 }).select('batchNumber').lean()
    ]);
    const maxUpstream = latestUpstream ? latestUpstream.batchNumber : 1000;
    const maxDispatch = latestDispatch ? latestDispatch.batchNumber : 1000;
    return Math.max(maxUpstream, maxDispatch) + 1;
}

async function seedBatches() {
    const { count: qtyPerModel, model: targetModel, isDirect } = parseArgs();

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

    // Fetch current sync watermark so new seeded batches are guaranteed to be newer than current watermark
    const syncStateDoc = await SyncState.findOne({ key: 'global_sync' }).lean();
    const currentWatermark = syncStateDoc && syncStateDoc.lastSyncedClosedAt ? new Date(syncStateDoc.lastSyncedClosedAt).getTime() : 0;

    const now = Date.now();
    const intervalMs = 2000; // 2 seconds between each batch
    const baseStartTime = Math.max(now, currentWatermark + 1000);

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

            const serialNumbers = generateRealSerials(1000 + (globalBoxIndex * batchSize), batchSize);

            const revNo = (model.productRevNo || 'Level 4').toUpperCase();
            const swRev = (model.softwareRevNo || 'SW2').toUpperCase();
            const supplier = model.supplierCode || '10156230';
            const intPart = model.internalPartId || model.modelId;
            const custPart = model.customerPartNo || 'N/A';

            const batchQrData = `*${supplier}|${intPart}|${custPart}|${revNo}|${swRev}|${batchDate}|1A(${batchNum})|${serialNumbers.join(', ')}*`;
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

        // Insert ONLY into upstream production batches collection by default
        if (upstreamBatches.length > 0) {
            await db.collection('batches').insertMany(upstreamBatches);
        }

        // If explicitly requested via --direct, also bypass sync and populate dispatch_boxes
        if (isDirect) {
            if (dispatchBoxes.length > 0) await DispatchBox.insertMany(dispatchBoxes);
            if (lifecycleEvents.length > 0) await BoxLifecycleEvent.insertMany(lifecycleEvents);
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

    // Fetch total available stock counts for verification
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
    console.log(`${C.bright}${C.green}✔ SUCCESS: Successfully created ${totalBoxesToCreate} production batches!${C.reset}`);
    console.log(`${C.bright}${C.green}════════════════════════════════════════════════════════════════════════════════${C.reset}\n`);

    console.table(summaryData.map(s => ({
        'Model ID': s.modelId,
        'Model Description': s.modelName,
        'Batch Size': `${s.batchSize} pcs`,
        'Upstream Batches Created': `+${s.boxesAdded}`,
        'Parts Created': `+${s.partsAdded}`,
        'Batch Range': s.batchRange,
        'Current Ingested Stock': `${stockMap[s.modelId]?.availableBoxes || 0} boxes (${stockMap[s.modelId]?.availableParts || 0} parts)`
    })));

    console.log(`\n${C.cyan}ℹ Global Batch Range:${C.reset} #${startBatchNumber} to #${currentBatchNumber - 1}`);
    console.log(`${C.cyan}ℹ Ingestion Status:${C.reset} Created in ${C.green}batches${C.reset} collection. Ready for background application ingestion.`);
    console.log(`${C.dim}Done.${C.reset}\n`);

    await mongoose.disconnect();
    process.exit(0);
}

seedBatches().catch(err => {
    console.error(`${C.red}✖ Failed to seed batches: ${err.message}${C.reset}`);
    console.error(err.stack);
    process.exit(1);
});
