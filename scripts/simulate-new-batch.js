// scripts/simulate-new-batch.js
// Advanced Batch & Lifecycle Traceability Simulator
// Simulates realistic production boxes and complex lifecycle audit histories:
// Fresh Ingested, On-Hold, Hold Released, Rejected, Reopened, Dispatched, or Full Audit Rollercoaster.

const mongoose = require('mongoose');
const path = require('path');
const readline = require('readline');

// Initialize encrypted config environment
try {
    const { initEnvironment } = require('../src/utils/cryptoConfig');
    initEnvironment();
} catch (e) {
    require('dotenv').config({ path: path.join(__dirname, '../.env') });
}

const {
    ProductModel,
    Batch,
    DispatchBox,
    DispatchTransaction,
    BoxLifecycleEvent
} = require('../src/models');
const { generateId } = require('../src/utils/idGenerator');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/plc_sticker';

const SCENARIOS = {
    1: { id: 'available', name: 'Fresh Ingested Box', desc: 'Ingested into stock; status: AVAILABLE (1 event: INGESTED)' },
    2: { id: 'hold', name: 'Active QA Hold', desc: 'Placed on QA hold; status: HOLD (2 events: INGESTED -> HELD)' },
    3: { id: 'released', name: 'Hold Placed & Released', desc: 'Held then cleared; status: AVAILABLE (3 events: INGESTED -> HELD -> RELEASED)' },
    4: { id: 'rejected', name: 'Active Rejection', desc: 'Scrapped/defective; status: REJECTED (2 events: INGESTED -> REJECTED)' },
    5: { id: 'reopened', name: 'Rejected & Manager Reopened', desc: 'Reopened by Manager; status: AVAILABLE (3 events: INGESTED -> REJECTED -> REOPENED)' },
    6: { id: 'dispatched', name: 'Dispatched (FIFO Order)', desc: 'Scanned & shipped; status: DISPATCHED (4 events + Dispatch Transaction)' },
    7: { id: 'full', name: 'Full Lifecycle Rollercoaster', desc: 'Complete audit stress-test (8 events: Ingested -> Held -> Released -> Rejected -> Reopened -> Allocated -> Scanned -> Dispatched)' },
    8: { id: 'partial', name: 'Partial / Short Box (30/50 pcs)', desc: 'Box closed prematurely with partial count (30 of 50 pcs completed)' },
    9: { id: 'all', name: 'Complete Simulation Suite', desc: 'Generates 1 box for EACH scenario above (8 distinct boxes)' }
};

async function getNextBatchNumber() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [latestUpstream, latestDispatch] = await Promise.all([
        Batch.findOne({ createdAt: { $gte: startOfDay } }).sort({ batchNumber: -1 }).select('batchNumber').lean(),
        DispatchBox.findOne({ createdAt: { $gte: startOfDay } }).sort({ batchNumber: -1 }).select('batchNumber').lean()
    ]);
    const maxUpstream = latestUpstream ? latestUpstream.batchNumber : 1000;
    const maxDispatch = latestDispatch ? latestDispatch.batchNumber : 1000;
    return Math.max(maxUpstream, maxDispatch) + 1;
}

async function simulateBoxScenario(scenarioType, options = {}) {
    const models = ['M001', 'M002', 'M003', 'M004'];
    const chosenModel = options.model || models[Math.floor(Math.random() * models.length)];
    const modelDoc = await ProductModel.findOne({ modelId: chosenModel }).lean();
    const batchSize = modelDoc ? modelDoc.batchSize : 20;

    const batchNumber = options.batchNumber || await getNextBatchNumber();

    // Chronological timestamps spaced backwards from now
    const now = new Date();
    const t0 = new Date(now.getTime() - 120 * 60 * 1000); // Production start: 2 hours ago
    const t1 = new Date(now.getTime() - 95 * 60 * 1000);  // Production closed: ~95 mins ago
    const t2 = new Date(now.getTime() - 80 * 60 * 1000);  // 80 mins ago
    const t3 = new Date(now.getTime() - 65 * 60 * 1000);  // 65 mins ago
    const t4 = new Date(now.getTime() - 50 * 60 * 1000);  // 50 mins ago
    const t5 = new Date(now.getTime() - 35 * 60 * 1000);  // 35 mins ago
    const t6 = new Date(now.getTime() - 20 * 60 * 1000);  // 20 mins ago
    const t7 = new Date(now.getTime() - 10 * 60 * 1000);  // 10 mins ago
    const t8 = now;                                        // Just now

    const yyyy = t1.getFullYear();
    const mm = String(t1.getMonth() + 1).padStart(2, '0');
    const dd = String(t1.getDate()).padStart(2, '0');
    const batchDate = `${yyyy}.${mm}.${dd}`;

    const targetCount = options.completedCount !== undefined
        ? options.completedCount
        : (scenarioType === 'partial' ? (chosenModel === 'M002' ? 30 : Math.max(1, Math.floor(batchSize * 0.6))) : batchSize);

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

    const serialNumbers = generateRealSerials(1000 + (batchNumber * batchSize), targetCount);
    const revNo = (modelDoc?.productRevNo || 'Level 4').toUpperCase();
    const swRev = (modelDoc?.softwareRevNo || 'SW2').toUpperCase();
    const supplier = modelDoc?.supplierCode || (chosenModel === 'M002' ? 'ABH006' : '10156230');
    const intPart = modelDoc?.internalPartId || (chosenModel === 'M002' ? 'AE-33.0006.00' : 'AE-33.0010.00');
    const custPart = modelDoc?.customerPartNo || (chosenModel === 'M002' ? 'E4MV-24136' : 'L003388589NCPAA');

    const batchQrData = `*${supplier}|${intPart}|${custPart}|${revNo}|${swRev}|${batchDate}|1A(${batchNumber})|${serialNumbers.join(', ')}*`;

    // 1. Create upstream production batch via native driver (bypassing read-only Mongoose guard)
    const insertResult = await mongoose.connection.db.collection('batches').insertOne({
        batchNumber,
        machineNo: 18,
        modelId: chosenModel,
        shiftCode: '1A',
        batchDate,
        batchSize,
        completedCount: targetCount,
        status: 'closed',
        serialNumbers,
        startedAt: t0,
        closedAt: t1,
        batchPrinted: true,
        batchQrData
    });

    // 2. Base Dispatch Box document
    const boxData = {
        batchId: insertResult.insertedId,
        batchNumber,
        modelId: chosenModel,
        machineNo: 18,
        shiftCode: '1A',
        batchDate,
        batchSize,
        completedCount: targetCount,
        serialNumbers,
        batchQrData,
        closedAt: t1,
        status: 'available'
    };

    const events = [];

    // Base Ingest Event (Common to all scenarios)
    events.push({
        batchNumber,
        modelId: chosenModel,
        eventType: 'BOX_INGESTED',
        performedBy: 'SYSTEM_SYNC',
        userRole: 'SYSTEM',
        timestamp: t1,
        remarks: targetCount < batchSize
            ? `Ingested partial production batch closed at shift handoff (${targetCount} of ${batchSize} pcs)`
            : `Ingested from Station 18 PLC (closed at ${t1.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }).toLowerCase()})`
    });

    // Apply Scenario Specific Lifecycles
    switch (scenarioType) {
        case 'available':
        case 'fresh':
            boxData.status = 'available';
            break;

        case 'hold': {
            const holdId = await generateId('HLD', t2);
            boxData.status = 'hold';
            boxData.holdId = holdId;
            boxData.holdReason = 'Dimensional Tolerance Out of Spec';
            boxData.holdRemarks = 'Sample bore diameter deviation +0.04mm on serials 003, 004.';
            boxData.heldBy = 'supervisor_qa';
            boxData.heldAt = t2;

            events.push({
                batchNumber,
                modelId: chosenModel,
                eventType: 'BOX_HELD',
                referenceId: holdId,
                performedBy: 'supervisor_qa',
                userRole: 'SUPERVISOR',
                timestamp: t2,
                reason: boxData.holdReason,
                remarks: boxData.holdRemarks
            });
            break;
        }

        case 'released': {
            const holdId = await generateId('HLD', t2);
            boxData.status = 'available';
            boxData.holdId = holdId;
            boxData.holdReason = 'Suspected Burr on Chamfer';
            boxData.holdRemarks = 'Visual burr observed under Station 18 inspection light.';
            boxData.heldBy = 'supervisor_qa';
            boxData.heldAt = t2;
            boxData.holdReleasedBy = 'supervisor_qa';
            boxData.holdReleasedAt = t3;

            events.push({
                batchNumber,
                modelId: chosenModel,
                eventType: 'BOX_HELD',
                referenceId: holdId,
                performedBy: 'supervisor_qa',
                userRole: 'SUPERVISOR',
                timestamp: t2,
                reason: boxData.holdReason,
                remarks: boxData.holdRemarks
            });
            events.push({
                batchNumber,
                modelId: chosenModel,
                eventType: 'BOX_HOLD_RELEASED',
                referenceId: holdId,
                performedBy: 'supervisor_qa',
                userRole: 'SUPERVISOR',
                timestamp: t3,
                remarks: 'Parts 100% deburred and verified with micrometer. Release authorized.'
            });
            break;
        }

        case 'rejected': {
            const rejectionId = await generateId('REJ', t2);
            boxData.status = 'rejected';
            boxData.rejectionId = rejectionId;
            boxData.rejectionReason = 'Laser Marking Illegible';
            boxData.rejectionRemarks = '2D DataMatrix contrast failed ISO 15415 verification (Grade F).';
            boxData.rejectedBy = 'supervisor_qa';
            boxData.rejectedAt = t2;

            events.push({
                batchNumber,
                modelId: chosenModel,
                eventType: 'BOX_REJECTED',
                referenceId: rejectionId,
                performedBy: 'supervisor_qa',
                userRole: 'SUPERVISOR',
                timestamp: t2,
                reason: boxData.rejectionReason,
                remarks: boxData.rejectionRemarks
            });
            break;
        }

        case 'reopened': {
            const rejectionId = await generateId('REJ', t2);
            boxData.status = 'available';
            boxData.rejectionId = rejectionId;
            boxData.rejectionReason = 'Packaging Barrier Torn';
            boxData.rejectionRemarks = 'VCI anti-rust bag punctured during handling.';
            boxData.rejectedBy = 'supervisor_qa';
            boxData.rejectedAt = t2;
            boxData.reopenedBy = 'plant_manager';
            boxData.reopenedAt = t3;
            boxData.reopenRemarks = 'Parts inspected 100% rust-free. Repacked in fresh VCI bag with new desiccant pouch. Reopening authorized.';

            events.push({
                batchNumber,
                modelId: chosenModel,
                eventType: 'BOX_REJECTED',
                referenceId: rejectionId,
                performedBy: 'supervisor_qa',
                userRole: 'SUPERVISOR',
                timestamp: t2,
                reason: boxData.rejectionReason,
                remarks: boxData.rejectionRemarks
            });
            events.push({
                batchNumber,
                modelId: chosenModel,
                eventType: 'BOX_REJECT_REOPENED',
                referenceId: rejectionId,
                performedBy: 'plant_manager',
                userRole: 'MANAGER',
                timestamp: t3,
                remarks: boxData.reopenRemarks
            });
            break;
        }

        case 'dispatched': {
            const dispatchId = await generateId('DSP', t2);
            boxData.status = 'dispatched';
            boxData.dispatchId = dispatchId;
            boxData.dispatchedBy = 'op_station18';
            boxData.dispatchedAt = t4;

            // Events: ALLOCATED -> SCANNED -> DISPATCHED
            events.push({
                batchNumber,
                modelId: chosenModel,
                eventType: 'BOX_ALLOCATED',
                referenceId: dispatchId,
                performedBy: 'op_station18',
                userRole: 'OPERATOR',
                timestamp: t2,
                remarks: `Allocated to dispatch order ${dispatchId} (Target: 1 BOX)`
            });
            events.push({
                batchNumber,
                modelId: chosenModel,
                eventType: 'BOX_SCANNED',
                referenceId: dispatchId,
                performedBy: 'op_station18',
                userRole: 'OPERATOR',
                timestamp: t3,
                remarks: `Physical QR scan verified at dispatch conveyor terminal`
            });
            events.push({
                batchNumber,
                modelId: chosenModel,
                eventType: 'BOX_DISPATCHED',
                referenceId: dispatchId,
                performedBy: 'op_station18',
                userRole: 'OPERATOR',
                timestamp: t4,
                remarks: `Confirmed and dispatched for Mahindra shipment ${dispatchId}`
            });

            // Create matching DispatchTransaction
            const boxDocTemp = await DispatchBox.create(boxData);
            await DispatchTransaction.create({
                dispatchId,
                modelId: chosenModel,
                targetType: 'boxes',
                targetQuantity: 1,
                status: 'completed',
                allocatedBoxes: [{
                    boxId: boxDocTemp._id,
                    batchNumber,
                    completedCount: batchSize,
                    batchQrData,
                    closedAt: t1,
                    serialNumbers
                }],
                scannedBoxes: [{
                    boxId: boxDocTemp._id,
                    batchNumber,
                    completedCount: batchSize,
                    scannedAt: t3
                }],
                dispatchedBoxCount: 1,
                dispatchedPartCount: batchSize,
                operatorUsername: 'op_station18',
                startedAt: t2,
                completedAt: t4,
                notes: 'Simulated dispatch order verification'
            });

            // Persist events with boxId
            for (const ev of events) {
                ev.boxId = boxDocTemp._id;
                await BoxLifecycleEvent.create(ev);
            }

            return {
                box: boxDocTemp,
                scenario: 'dispatched',
                eventsCount: events.length,
                batchNumber,
                chosenModel,
                serialSample: serialNumbers[0],
                batchQrData
            };
        }

        case 'full': {
            // Rollercoaster: INGESTED -> HELD -> RELEASED -> REJECTED -> REOPENED -> ALLOCATED -> SCANNED -> DISPATCHED
            const holdId = await generateId('HLD', t2);
            const rejId = await generateId('REJ', t4);
            const dspId = await generateId('DSP', t6);

            boxData.status = 'dispatched';
            boxData.holdId = holdId;
            boxData.holdReason = 'Random QA Batch Audit Hold';
            boxData.holdRemarks = 'Selected for station 18 visual sampling';
            boxData.heldBy = 'supervisor_qa';
            boxData.heldAt = t2;
            boxData.holdReleasedBy = 'supervisor_qa';
            boxData.holdReleasedAt = t3;

            boxData.rejectionId = rejId;
            boxData.rejectionReason = 'Tape Seal Damaged';
            boxData.rejectionRemarks = 'Side carton flap seal broken during internal transport';
            boxData.rejectedBy = 'supervisor_qa';
            boxData.rejectedAt = t4;
            boxData.reopenedBy = 'plant_manager';
            boxData.reopenedAt = t5;
            boxData.reopenRemarks = 'Contents inspected undamaged. Re-sealed with reinforced tamper-evident tape.';

            boxData.dispatchId = dspId;
            boxData.dispatchedBy = 'op_station18';
            boxData.dispatchedAt = t8;

            events.push({
                batchNumber,
                modelId: chosenModel,
                eventType: 'BOX_HELD',
                referenceId: holdId,
                performedBy: 'supervisor_qa',
                userRole: 'SUPERVISOR',
                timestamp: t2,
                reason: boxData.holdReason,
                remarks: boxData.holdRemarks
            });
            events.push({
                batchNumber,
                modelId: chosenModel,
                eventType: 'BOX_HOLD_RELEASED',
                referenceId: holdId,
                performedBy: 'supervisor_qa',
                userRole: 'SUPERVISOR',
                timestamp: t3,
                remarks: 'QA sampling passed. Dimensional checks normal.'
            });
            events.push({
                batchNumber,
                modelId: chosenModel,
                eventType: 'BOX_REJECTED',
                referenceId: rejId,
                performedBy: 'supervisor_qa',
                userRole: 'SUPERVISOR',
                timestamp: t4,
                reason: boxData.rejectionReason,
                remarks: boxData.rejectionRemarks
            });
            events.push({
                batchNumber,
                modelId: chosenModel,
                eventType: 'BOX_REJECT_REOPENED',
                referenceId: rejId,
                performedBy: 'plant_manager',
                userRole: 'MANAGER',
                timestamp: t5,
                remarks: boxData.reopenRemarks
            });
            events.push({
                batchNumber,
                modelId: chosenModel,
                eventType: 'BOX_ALLOCATED',
                referenceId: dspId,
                performedBy: 'op_station18',
                userRole: 'OPERATOR',
                timestamp: t6,
                remarks: `Allocated to dispatch shipment ${dspId}`
            });
            events.push({
                batchNumber,
                modelId: chosenModel,
                eventType: 'BOX_SCANNED',
                referenceId: dspId,
                performedBy: 'op_station18',
                userRole: 'OPERATOR',
                timestamp: t7,
                remarks: `Scanned & matched by Honeywell 1900G barcode reader`
            });
            events.push({
                batchNumber,
                modelId: chosenModel,
                eventType: 'BOX_DISPATCHED',
                referenceId: dspId,
                performedBy: 'op_station18',
                userRole: 'OPERATOR',
                timestamp: t8,
                remarks: `Manifest closed and loaded into dispatch staging dock`
            });

            const boxDocTemp = await DispatchBox.create(boxData);
            await DispatchTransaction.create({
                dispatchId: dspId,
                modelId: chosenModel,
                targetType: 'boxes',
                targetQuantity: 1,
                status: 'completed',
                allocatedBoxes: [{
                    boxId: boxDocTemp._id,
                    batchNumber,
                    completedCount: batchSize,
                    batchQrData,
                    closedAt: t1,
                    serialNumbers
                }],
                scannedBoxes: [{
                    boxId: boxDocTemp._id,
                    batchNumber,
                    completedCount: batchSize,
                    scannedAt: t7
                }],
                dispatchedBoxCount: 1,
                dispatchedPartCount: batchSize,
                operatorUsername: 'op_station18',
                startedAt: t6,
                completedAt: t8,
                notes: 'Full lifecycle stress test order'
            });

            for (const ev of events) {
                ev.boxId = boxDocTemp._id;
                await BoxLifecycleEvent.create(ev);
            }

            return {
                box: boxDocTemp,
                scenario: 'full',
                eventsCount: events.length,
                batchNumber,
                chosenModel,
                serialSample: serialNumbers[0],
                batchQrData
            };
        }

        default:
            boxData.status = 'available';
    }

    // Persist box and events for non-dispatched flows
    const boxDoc = await DispatchBox.create(boxData);
    for (const ev of events) {
        ev.boxId = boxDoc._id;
        await BoxLifecycleEvent.create(ev);
    }

    return {
        box: boxDoc,
        scenario: scenarioType,
        eventsCount: events.length,
        batchNumber,
        chosenModel,
        serialSample: serialNumbers[0],
        batchQrData
    };
}

async function runInteractiveMenu() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const ask = (query) => new Promise((resolve) => rl.question(query, resolve));

    console.log('\n================================================================');
    console.log('       BGL DISPATCH SYSTEM - BATCH & TRACEABILITY SIMULATOR     ');
    console.log('================================================================');
    console.log('Select a box lifecycle scenario to simulate:\n');

    Object.entries(SCENARIOS).forEach(([key, sc]) => {
        console.log(`  [${key}] ${sc.name.padEnd(30)} - ${sc.desc}`);
    });
    console.log('');

    const choice = (await ask('Select scenario [1-8] (default: 8 - Complete Suite): ')).trim() || '8';
    rl.close();

    const selected = SCENARIOS[choice] || SCENARIOS[8];
    console.log(`\n>> Executing: ${selected.name}...\n`);

    if (selected.id === 'all') {
        await runAllScenarios();
    } else {
        const result = await simulateBoxScenario(selected.id);
        printResultsTable([result]);
    }
}

async function runAllScenarios() {
    const suite = ['available', 'partial', 'hold', 'released', 'rejected', 'reopened', 'dispatched', 'full'];
    const results = [];
    const models = ['M001', 'M002', 'M003', 'M004'];

    console.log('[SUITE] Generating 1 box for each lifecycle scenario...\n');
    let nextNum = await getNextBatchNumber();

    for (let i = 0; i < suite.length; i++) {
        const scenario = suite[i];
        const model = models[i % models.length];
        const res = await simulateBoxScenario(scenario, {
            model,
            batchNumber: nextNum++
        });
        results.push(res);
    }

    printResultsTable(results);
}

function printResultsTable(results) {
    console.log('------------------------------------------------------------------------------------------------------------------');
    console.log(`| BOX #  | MODEL | STATUS     | EVENTS | SAMPLE SERIAL NUMBER          | SEARCH QUERY / QR DATA                  |`);
    console.log('------------------------------------------------------------------------------------------------------------------');

    results.forEach(r => {
        const boxNo = String(r.batchNumber).padEnd(6);
        const model = r.chosenModel.padEnd(5);
        const status = r.box.status.toUpperCase().padEnd(10);
        const events = String(r.eventsCount).padStart(2) + ' evts';
        const serial = r.serialSample.padEnd(29);
        const qr = r.batchQrData.padEnd(40);
        console.log(`| ${boxNo} | ${model} | ${status} | ${events} | ${serial} | ${qr} |`);
    });
    console.log('------------------------------------------------------------------------------------------------------------------');

    console.log('\n[TESTING INSTRUCTIONS]');
    console.log('1. Open your Dispatch web application in the browser.');
    console.log('2. Click "BOX TRACEABILITY" on the left navigation rail.');
    console.log('3. Test by searching any of the following:');
    console.log(`   - By Box Number:        ${results[0].batchNumber}`);
    console.log(`   - By Individual Serial: ${results[0].serialSample}`);
    console.log(`   - By Full QR Payload:   ${results[0].batchQrData}`);
    console.log('\nYou can now inspect the chronological timeline, timestamps, reference IDs, and role audit stamps!\n');
}

async function main() {
    try {
        console.log(`[CONNECTING] Connecting to database: ${MONGO_URI.replace(/:([^:@]+)@/, ':****@')}...`);
        await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 5000
        });

        const args = process.argv.slice(2);

        if (args.includes('--help') || args.includes('-h')) {
            console.log(`
Usage:
  node scripts/simulate-new-batch.js [options]
  npm run simulate:batch

Options:
  --scenario <type>   Simulate specific scenario:
                      available, hold, released, rejected, reopened, dispatched, full, all
  --model <modelId>   Target model: M001, M002, M003, M004
  --all               Generate all scenarios in a single suite
  --help              Show this help message
            `);
            process.exit(0);
        }

        if (args.includes('--all')) {
            await runAllScenarios();
        } else {
            const scenarioArg = args.find((_, i) => args[i - 1] === '--scenario');
            const modelArg = args.find((_, i) => args[i - 1] === '--model');

            if (scenarioArg) {
                const res = await simulateBoxScenario(scenarioArg.toLowerCase(), { model: modelArg });
                printResultsTable([res]);
            } else if (args.length === 0) {
                await runInteractiveMenu();
            } else {
                // If unknown flag, default to interactive
                await runInteractiveMenu();
            }
        }

        await mongoose.disconnect();
        process.exit(0);
    } catch (err) {
        console.error('\n[SIMULATION ERROR]', err.message);
        try { await mongoose.disconnect(); } catch (_) { }
        process.exit(1);
    }
}

main();
