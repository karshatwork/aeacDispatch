// scripts/seed-production-data.js
// Seeds realistic production models and closed batches into the upstream database (plc_sticker)
// so that the background syncService can ingest them into the dispatch system.

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/plc_sticker';

async function seed() {
    console.log(`[SEED] Connecting to upstream database: ${MONGO_URI}...`);
    const conn = await mongoose.createConnection(MONGO_URI, {
        serverSelectionTimeoutMS: 5000
    }).asPromise();

    const db = conn.db;

    // 1. Seed Product Models
    console.log('[SEED] Seeding productmodels collection...');
    const modelsData = [
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
            active: true,
            createdAt: new Date('2026-04-14T10:56:23.427Z')
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
            active: true,
            createdAt: new Date('2026-05-10T09:47:51.748Z')
        },
        {
            modelId: 'M003',
            modelName: 'AE-33.0008.00 - Mahindra XUV',
            batchSize: 50,
            supplierCode: 'MHD008',
            internalPartId: 'AE-33.0008.00',
            customerPartNo: 'M700-14299A',
            productRevNo: 'Level 3',
            softwareRevNo: 'SW1',
            customerName: 'Mahindra & Mahindra',
            logoText: 'M&M',
            serialPrnTemplate: 'serial_template.prn',
            batchPrnTemplate: 'batch_template.prn',
            active: true,
            createdAt: new Date('2026-06-01T08:12:00.000Z')
        },
        {
            modelId: 'M004',
            modelName: 'AE-33.0012.00 - Tata Motors EV',
            batchSize: 40,
            supplierCode: 'TTA012',
            internalPartId: 'AE-33.0012.00',
            customerPartNo: 'T500-99881B',
            productRevNo: 'Level 5',
            softwareRevNo: 'SW3',
            customerName: 'Tata Motors',
            logoText: 'TATA',
            serialPrnTemplate: 'serial_template.prn',
            batchPrnTemplate: 'batch_template.prn',
            active: true,
            createdAt: new Date('2026-07-15T11:30:00.000Z')
        }
    ];

    for (const m of modelsData) {
        await db.collection('productmodels').updateOne(
            { modelId: m.modelId },
            { $set: m },
            { upsert: true }
        );
    }
    console.log(`[SEED] Upserted ${modelsData.length} product models.`);

    // 2. Clear existing test batches and reset sync state watermark
    console.log('[SEED] Preparing batches collection...');
    await db.collection('batches').deleteMany({});
    await db.collection('dispatch_boxes').deleteMany({});
    await db.collection('dispatch_transactions').deleteMany({});
    await db.collection('dispatch_box_events').deleteMany({});

    // Reset sync state watermark to 2 days ago so all new batches are immediately ingested
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() - 2);

    await db.collection('dispatch_sync_state').updateOne(
        { key: 'global_sync' },
        {
            $set: {
                lastSyncedClosedAt: baseDate,
                lastBatchNumber: null,
                totalSyncedBoxes: 0,
                isInitialized: true,
                lastSyncRunAt: new Date()
            }
        },
        { upsert: true }
    );
    console.log(`[SEED] Reset sync watermark to ${baseDate.toISOString()} for clean sync demonstration.`);

    // 3. Generate Bulk Closed Batches across models and machines
    const batches = [];
    let batchNumber = 1001;
    const machines = [18, 18, 18, 19]; // Station 18 & 19
    const shifts = ['1A', '2B', '3C'];

    // Generate 6 batches per model = 24 total boxes
    for (const model of modelsData) {
        for (let i = 0; i < 6; i++) {
            const batchSize = model.batchSize;
            const machine = machines[(batchNumber) % machines.length];
            const shift = shifts[(batchNumber) % shifts.length];

            // Space closedAt times sequentially over the last 24 hours
            const minutesAgo = 1440 - (batchNumber - 1000) * 45; // descending minutes ago
            const closedAt = new Date(Date.now() - minutesAgo * 60 * 1000);
            const startedAt = new Date(closedAt.getTime() - 40 * 60 * 1000); // 40 mins production run

            const yyyy = closedAt.getFullYear();
            const mm = String(closedAt.getMonth() + 1).padStart(2, '0');
            const dd = String(closedAt.getDate()).padStart(2, '0');
            const batchDate = `${yyyy}.${mm}.${dd}`;

            // Generate serial numbers for this batch
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

            const serialNumbers = generateRealSerials(1000 + (batchNumber * batchSize), batchSize);
            const revNo = (model.productRevNo || 'Level 4').toUpperCase();
            const swRev = (model.softwareRevNo || 'SW2').toUpperCase();
            const supplier = model.supplierCode || '10156230';
            const intPart = model.internalPartId || model.modelId;
            const custPart = model.customerPartNo || 'N/A';

            const batchQrData = `*${supplier}|${intPart}|${custPart}|${revNo}|${swRev}|${batchDate}|${shift}(${batchNumber})|${serialNumbers.join(', ')}*`;

            batches.push({
                batchNumber,
                machineNo: machine,
                modelId: model.modelId,
                shiftCode: shift,
                batchDate,
                batchSize,
                completedCount: batchSize,
                status: 'closed',
                serialNumbers,
                startedAt,
                closedAt,
                batchPrinted: true,
                batchQrData
            });

            batchNumber++;
        }
    }

    const insertRes = await db.collection('batches').insertMany(batches);
    console.log(`[SEED] Successfully inserted ${insertRes.insertedCount} closed batches into 'batches' collection.`);

    await conn.close();

    // 4. Trigger sync pass to demonstrate immediate ingestion
    console.log('[SEED] Triggering sync pass via syncService...');
    const syncService = require('../src/services/syncService');
    const { connectDB } = require('../src/config/db');

    await connectDB(MONGO_URI);
    const syncResult = await syncService.performSync();
    console.log(`[SYNC RESULT] Processed & ingested: ${syncResult.processed} boxes.`);
    console.log(`[SYNC RESULT] Advanced watermark to: ${syncResult.watermark ? syncResult.watermark.toISOString() : 'N/A'}`);

    // Print summary
    console.log('\n============================================================');
    console.log(' SEEDING & SYNCHRONIZATION COMPLETE');
    console.log('============================================================');
    console.log(`Database:              ${MONGO_URI}`);
    console.log(`Models available:      ${modelsData.length} (M001, M002, M003, M004)`);
    console.log(`Batches in production: ${batches.length} closed batches`);
    console.log(`Boxes in Dispatch DB:  ${syncResult.processed} available boxes ready for dispatch`);
    console.log('Sample QR Scans for Testing:');
    for (let k = 0; k < 4; k++) {
        const b = batches[k * 6];
        console.log(` - Model ${b.modelId} (Batch #${b.batchNumber}): "${b.batchQrData}"`);
    }
    console.log('============================================================\n');

    process.exit(0);
}

seed().catch(err => {
    console.error('[SEED ERROR]', err);
    process.exit(1);
});
