// src/utils/dummyDataSeeder.js - Comprehensive Industrial Test Data Generator
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const DEMO_MODELS = [
    {
        modelId: 'MD-X100',
        modelName: 'Mahindra X100 Body Controller',
        batchSize: 50,
        supplierCode: 'ELEK01',
        internalPartId: 'IP-9901',
        customerPartNo: 'MN-0091-BCM',
        productRevNo: 'L2',
        softwareRevNo: 'SW04',
        customerName: 'Mahindra & Mahindra',
        logoText: 'Elektrosil',
        active: true,
        createdAt: new Date(Date.now() - 30 * 86400000)
    },
    {
        modelId: 'MD-X200',
        modelName: 'Mahindra X200 Power Relay Unit',
        batchSize: 100,
        supplierCode: 'ELEK01',
        internalPartId: 'IP-9902',
        customerPartNo: 'MN-0092-PRU',
        productRevNo: 'L1',
        softwareRevNo: 'SW02',
        customerName: 'Mahindra & Mahindra',
        logoText: 'Elektrosil',
        active: true,
        createdAt: new Date(Date.now() - 30 * 86400000)
    },
    {
        modelId: 'MD-X300',
        modelName: 'Mahindra Scorpio ESP Module',
        batchSize: 40,
        supplierCode: 'ELEK01',
        internalPartId: 'IP-9903',
        customerPartNo: 'MN-0093-ESP',
        productRevNo: 'L3',
        softwareRevNo: 'SW08',
        customerName: 'Mahindra & Mahindra',
        logoText: 'Elektrosil',
        active: true,
        createdAt: new Date(Date.now() - 30 * 86400000)
    },
    {
        modelId: 'MD-THAR',
        modelName: 'Mahindra Thar Drive Control Unit',
        batchSize: 60,
        supplierCode: 'ELEK01',
        internalPartId: 'IP-9904',
        customerPartNo: 'MN-0094-TDM',
        productRevNo: 'L2',
        softwareRevNo: 'SW05',
        customerName: 'Mahindra & Mahindra',
        logoText: 'Elektrosil',
        active: true,
        createdAt: new Date(Date.now() - 30 * 86400000)
    }
];

function generateSerials(modelId, batchNumber, count) {
    const list = [];
    const prefix = modelId.replace('-', '');
    for (let i = 1; i <= count; i++) {
        list.push(`${prefix}-${batchNumber}-${String(i).padStart(4, '0')}`);
    }
    return list;
}

function generateQr(model, batchNumber, dateStr, shift, serials) {
    const previewSerials = serials.slice(0, 4).join(', ');
    return `*${model.supplierCode}|${model.internalPartId}|${model.customerPartNo}|${model.productRevNo}|${model.softwareRevNo}|${dateStr}|${shift}(${batchNumber})|${previewSerials}...*`;
}

/**
 * Seeds loads of dummy data across models, batches, boxes (available, hold, rejected, dispatched),
 * historical transactions with complete bill breakdowns, and box lifecycle audit trails.
 */
async function seedAll(db, { force = false } = {}) {
    const now = Date.now();

    if (force) {
        // Clear collections for a fresh rich seed
        await db.collection('productmodels').deleteMany({});
        await db.collection('batches').deleteMany({});
        await db.collection('dispatch_boxes').deleteMany({});
        await db.collection('dispatch_transactions').deleteMany({});
        await db.collection('dispatch_box_events').deleteMany({});
    }

    // 1. Seed Product Models
    const existingModels = await db.collection('productmodels').countDocuments();
    if (existingModels === 0) {
        await db.collection('productmodels').insertMany(DEMO_MODELS);
        console.log(`[SEED] Seeded ${DEMO_MODELS.length} demo product models.`);
    }

    // Check if boxes already exist and not forcing
    const existingBoxCount = await db.collection('dispatch_boxes').countDocuments();
    if (existingBoxCount > 0 && !force) {
        return {
            modelsCount: await db.collection('productmodels').countDocuments(),
            boxesCount: existingBoxCount,
            transactionsCount: await db.collection('dispatch_transactions').countDocuments(),
            message: 'Data already exists. Use force=true to re-seed.'
        };
    }

    const batchesToInsert = [];
    const boxesToInsert = [];
    const eventsToInsert = [];
    const transactionsToInsert = [];

    // Helper to register box and batch
    function createBoxRecord({
        model,
        batchNumber,
        hoursAgo,
        status = 'available',
        holdInfo = null,
        rejectInfo = null,
        dispatchInfo = null,
        machineNo = 1,
        shiftCode = '1A'
    }) {
        const closedAt = new Date(now - hoursAgo * 3600 * 1000);
        const startedAt = new Date(closedAt.getTime() - 3600 * 1000);
        const dateStr = closedAt.toISOString().slice(0, 10).replace(/-/g, '.');
        const serials = generateSerials(model.modelId, batchNumber, model.batchSize);
        const batchQr = generateQr(model, batchNumber, dateStr, shiftCode, serials);
        const batchId = new mongoose.Types.ObjectId();
        const boxId = new mongoose.Types.ObjectId();

        // Production batch
        const batchDoc = {
            _id: batchId,
            batchNumber,
            machineNo,
            modelId: model.modelId,
            shiftCode,
            batchDate: dateStr,
            batchSize: model.batchSize,
            completedCount: model.batchSize,
            status: 'closed',
            serialNumbers: serials,
            startedAt,
            closedAt,
            batchPrinted: true,
            batchQrData: batchQr
        };
        batchesToInsert.push(batchDoc);

        // Dispatch box
        const boxDoc = {
            _id: boxId,
            batchId,
            batchNumber,
            modelId: model.modelId,
            machineNo,
            shiftCode,
            batchDate: dateStr,
            batchSize: model.batchSize,
            completedCount: model.batchSize,
            serialNumbers: serials,
            batchQrData: batchQr,
            closedAt,
            status,
            createdAt: closedAt,
            updatedAt: new Date()
        };

        if (holdInfo) {
            Object.assign(boxDoc, holdInfo);
        }
        if (rejectInfo) {
            Object.assign(boxDoc, rejectInfo);
        }
        if (dispatchInfo) {
            Object.assign(boxDoc, dispatchInfo);
        }

        boxesToInsert.push(boxDoc);

        // Lifecycle event: Ingestion
        eventsToInsert.push({
            boxId,
            batchNumber,
            modelId: model.modelId,
            eventType: 'BOX_INGESTED',
            referenceId: `BATCH-${batchNumber}`,
            performedBy: 'system_sync',
            userRole: 'system',
            timestamp: new Date(closedAt.getTime() + 60000),
            reason: 'Production Closed Batch Synced to Dispatch FIFO Pool',
            remarks: `Initial sync of ${model.batchSize} verified units`
        });

        if (status === 'hold') {
            eventsToInsert.push({
                boxId,
                batchNumber,
                modelId: model.modelId,
                eventType: 'BOX_HELD',
                referenceId: holdInfo.holdId,
                performedBy: holdInfo.heldBy,
                userRole: 'supervisor',
                timestamp: holdInfo.heldAt,
                reason: holdInfo.holdReason,
                remarks: holdInfo.holdRemarks
            });
        } else if (status === 'rejected') {
            eventsToInsert.push({
                boxId,
                batchNumber,
                modelId: model.modelId,
                eventType: 'BOX_REJECTED',
                referenceId: rejectInfo.rejectionId,
                performedBy: rejectInfo.rejectedBy,
                userRole: 'supervisor',
                timestamp: rejectInfo.rejectedAt,
                reason: rejectInfo.rejectionReason,
                remarks: rejectInfo.rejectionRemarks
            });
        } else if (status === 'dispatched') {
            eventsToInsert.push({
                boxId,
                batchNumber,
                modelId: model.modelId,
                eventType: 'BOX_DISPATCHED',
                referenceId: dispatchInfo.dispatchId,
                performedBy: dispatchInfo.dispatchedBy,
                userRole: 'operator',
                timestamp: dispatchInfo.dispatchedAt,
                reason: 'Dispatched through Outbound Gate',
                remarks: `Loaded in shipment ${dispatchInfo.dispatchId}`
            });
        }

        return boxDoc;
    }

    const [m1, m2, m3, m4] = DEMO_MODELS;

    // -------------------------------------------------------------
    // 2. AVAILABLE BINS (18 boxes total - across models in FIFO order)
    // -------------------------------------------------------------
    // MD-X100 (6 available)
    createBoxRecord({ model: m1, batchNumber: 105, hoursAgo: 16, machineNo: 1, shiftCode: '1A' });
    createBoxRecord({ model: m1, batchNumber: 106, hoursAgo: 14, machineNo: 1, shiftCode: '1A' });
    createBoxRecord({ model: m1, batchNumber: 107, hoursAgo: 11, machineNo: 2, shiftCode: '2B' });
    createBoxRecord({ model: m1, batchNumber: 108, hoursAgo: 8, machineNo: 1, shiftCode: '2B' });
    createBoxRecord({ model: m1, batchNumber: 109, hoursAgo: 5, machineNo: 1, shiftCode: '3C' });
    createBoxRecord({ model: m1, batchNumber: 110, hoursAgo: 2, machineNo: 2, shiftCode: '3C' });

    // MD-X200 (5 available)
    createBoxRecord({ model: m2, batchNumber: 204, hoursAgo: 20, machineNo: 2, shiftCode: '1A' });
    createBoxRecord({ model: m2, batchNumber: 205, hoursAgo: 17, machineNo: 3, shiftCode: '1A' });
    createBoxRecord({ model: m2, batchNumber: 206, hoursAgo: 12, machineNo: 2, shiftCode: '2B' });
    createBoxRecord({ model: m2, batchNumber: 207, hoursAgo: 7, machineNo: 3, shiftCode: '2B' });
    createBoxRecord({ model: m2, batchNumber: 208, hoursAgo: 3, machineNo: 2, shiftCode: '3C' });

    // MD-X300 (4 available)
    createBoxRecord({ model: m3, batchNumber: 303, hoursAgo: 15, machineNo: 1, shiftCode: '1A' });
    createBoxRecord({ model: m3, batchNumber: 304, hoursAgo: 10, machineNo: 2, shiftCode: '2B' });
    createBoxRecord({ model: m3, batchNumber: 305, hoursAgo: 6, machineNo: 1, shiftCode: '2B' });
    createBoxRecord({ model: m3, batchNumber: 306, hoursAgo: 2, machineNo: 1, shiftCode: '3C' });

    // MD-THAR (3 available)
    createBoxRecord({ model: m4, batchNumber: 403, hoursAgo: 18, machineNo: 3, shiftCode: '1A' });
    createBoxRecord({ model: m4, batchNumber: 404, hoursAgo: 9, machineNo: 3, shiftCode: '2B' });
    createBoxRecord({ model: m4, batchNumber: 405, hoursAgo: 4, machineNo: 3, shiftCode: '3C' });

    // -------------------------------------------------------------
    // 3. HELD BINS (8 boxes - various realistic industrial hold reasons)
    // -------------------------------------------------------------
    createBoxRecord({
        model: m1,
        batchNumber: 103,
        hoursAgo: 19,
        status: 'hold',
        holdInfo: {
            holdId: 'HLD202609260001',
            holdReason: 'Barcode Quality Check',
            holdRemarks: 'Scanner reading degraded due to ribbon contrast on thermal printer',
            heldBy: 'supervisor1',
            heldAt: new Date(now - 18 * 3600 * 1000)
        }
    });

    createBoxRecord({
        model: m1,
        batchNumber: 104,
        hoursAgo: 25,
        status: 'hold',
        holdInfo: {
            holdId: 'HLD202609250001',
            holdReason: 'Awaiting Lab Thermal Report',
            holdRemarks: 'Periodic environmental chamber sample pulled by quality control',
            heldBy: 'manager1',
            heldAt: new Date(now - 24 * 3600 * 1000)
        }
    });

    createBoxRecord({
        model: m2,
        batchNumber: 202,
        hoursAgo: 22,
        status: 'hold',
        holdInfo: {
            holdId: 'HLD202609260002',
            holdReason: 'Packaging Tape Seal Broken',
            holdRemarks: 'Security tamper tape edge lifted during bin transfer to staging',
            heldBy: 'supervisor1',
            heldAt: new Date(now - 14 * 3600 * 1000)
        }
    });

    createBoxRecord({
        model: m2,
        batchNumber: 209,
        hoursAgo: 4,
        status: 'hold',
        holdInfo: {
            holdId: 'HLD202609260003',
            holdReason: 'Missing Operator Initials on Traveler',
            holdRemarks: 'Line traveler sheet incomplete; operator to sign off before release',
            heldBy: 'supervisor1',
            heldAt: new Date(now - 3 * 3600 * 1000)
        }
    });

    createBoxRecord({
        model: m3,
        batchNumber: 302,
        hoursAgo: 28,
        status: 'hold',
        holdInfo: {
            holdId: 'HLD202609250002',
            holdReason: 'Surface Scratches on Connector',
            holdRemarks: 'Minor handling scuffs observed on terminal shroud; engineering review needed',
            heldBy: 'supervisor1',
            heldAt: new Date(now - 26 * 3600 * 1000)
        }
    });

    createBoxRecord({
        model: m3,
        batchNumber: 307,
        hoursAgo: 5,
        status: 'hold',
        holdInfo: {
            holdId: 'HLD202609260004',
            holdReason: 'Customer Pre-Shipment Audit Sample',
            holdRemarks: 'Set aside for Mahindra supplier quality representative inspection visit',
            heldBy: 'manager1',
            heldAt: new Date(now - 4 * 3600 * 1000)
        }
    });

    createBoxRecord({
        model: m4,
        batchNumber: 402,
        hoursAgo: 24,
        status: 'hold',
        holdInfo: {
            holdId: 'HLD202609250003',
            holdReason: 'Sticker Missing Shift Code',
            holdRemarks: 'Line label print missing shift code suffix; reprint required',
            heldBy: 'operator1',
            heldAt: new Date(now - 23 * 3600 * 1000)
        }
    });

    createBoxRecord({
        model: m4,
        batchNumber: 406,
        hoursAgo: 6,
        status: 'hold',
        holdInfo: {
            holdId: 'HLD202609260005',
            holdReason: 'Weight Check Tolerance Deviation',
            holdRemarks: 'Tare weight recorded 15g above standard spec; recounting required',
            heldBy: 'supervisor1',
            heldAt: new Date(now - 5 * 3600 * 1000)
        }
    });

    // -------------------------------------------------------------
    // 4. REJECTED BINS (6 boxes - realistic QA scrap & damage reasons)
    // -------------------------------------------------------------
    createBoxRecord({
        model: m1,
        batchNumber: 101,
        hoursAgo: 36,
        status: 'rejected',
        rejectInfo: {
            rejectionId: 'REJ202609250001',
            rejectionReason: 'Carton Punctured by Forklift',
            rejectionRemarks: 'Severe corner impact crushed 8 inner housings; marked scrap for salvage',
            rejectedBy: 'supervisor1',
            rejectedAt: new Date(now - 34 * 3600 * 1000)
        }
    });

    createBoxRecord({
        model: m1,
        batchNumber: 102,
        hoursAgo: 30,
        status: 'rejected',
        rejectInfo: {
            rejectionId: 'REJ202609250002',
            rejectionReason: 'Internal Moisture Indicator Tripped',
            rejectionRemarks: 'Humidity sensor strip showed blue exposure due to punctured polybag',
            rejectedBy: 'supervisor1',
            rejectedAt: new Date(now - 28 * 3600 * 1000)
        }
    });

    createBoxRecord({
        model: m2,
        batchNumber: 201,
        hoursAgo: 40,
        status: 'rejected',
        rejectInfo: {
            rejectionId: 'REJ202609240001',
            rejectionReason: 'Electrical Hi-Pot Test Failure',
            rejectionRemarks: 'Dielectric insulation breakdown detected during end-of-line verification',
            rejectedBy: 'manager1',
            rejectedAt: new Date(now - 38 * 3600 * 1000)
        }
    });

    createBoxRecord({
        model: m2,
        batchNumber: 203,
        hoursAgo: 24,
        status: 'rejected',
        rejectInfo: {
            rejectionId: 'REJ202609250003',
            rejectionReason: 'Solder Bridge on Secondary Board',
            rejectionRemarks: 'SMT solder overflow on power pins; quarantine returned to rework cell',
            rejectedBy: 'supervisor1',
            rejectedAt: new Date(now - 22 * 3600 * 1000)
        }
    });

    createBoxRecord({
        model: m3,
        batchNumber: 301,
        hoursAgo: 45,
        status: 'rejected',
        rejectInfo: {
            rejectionId: 'REJ202609240002',
            rejectionReason: 'Component Pins Bent During Handling',
            rejectionRemarks: '4 male connector pins bent beyond 15 degrees angle limit',
            rejectedBy: 'supervisor1',
            rejectedAt: new Date(now - 42 * 3600 * 1000)
        }
    });

    createBoxRecord({
        model: m4,
        batchNumber: 401,
        hoursAgo: 38,
        status: 'rejected',
        rejectInfo: {
            rejectionId: 'REJ202609240003',
            rejectionReason: 'Housing Latch Broken During Assembly',
            rejectionRemarks: 'Ultrasonic weld seam cracked at side locking tab',
            rejectedBy: 'supervisor1',
            rejectedAt: new Date(now - 35 * 3600 * 1000)
        }
    });

    // -------------------------------------------------------------
    // 5. PAST DISPATCHED BINS & HISTORICAL TRANSACTIONS (5 Transactions, 12 Boxes)
    // -------------------------------------------------------------
    // Helper to build a historical dispatch transaction
    function createHistoricalTransaction({
        dispatchId,
        model,
        hoursAgo,
        boxNumbers,
        operatorUsername,
        notes
    }) {
        const completedAt = new Date(now - hoursAgo * 3600 * 1000);
        const startedAt = new Date(completedAt.getTime() - 25 * 60 * 1000);
        const boxesForTx = [];

        boxNumbers.forEach((bNum, idx) => {
            const boxDoc = createBoxRecord({
                model,
                batchNumber: bNum,
                hoursAgo: hoursAgo + 12 - idx,
                status: 'dispatched',
                dispatchInfo: {
                    dispatchId,
                    dispatchedBy: operatorUsername,
                    dispatchedAt: completedAt
                }
            });
            boxesForTx.push(boxDoc);
        });

        const txDoc = {
            dispatchId,
            modelId: model.modelId,
            targetType: 'boxes',
            targetQuantity: boxNumbers.length,
            status: 'completed',
            allocatedBoxes: boxesForTx.map(b => ({
                boxId: b._id,
                batchNumber: b.batchNumber,
                completedCount: b.completedCount,
                batchQrData: b.batchQrData,
                closedAt: b.closedAt,
                serialNumbers: b.serialNumbers
            })),
            scannedBoxes: boxesForTx.map((b, idx) => ({
                boxId: b._id,
                batchNumber: b.batchNumber,
                completedCount: b.completedCount,
                scannedAt: new Date(startedAt.getTime() + (idx + 1) * 3 * 60 * 1000)
            })),
            dispatchedBoxCount: boxNumbers.length,
            dispatchedPartCount: boxNumbers.length * model.batchSize,
            operatorUsername,
            startedAt,
            completedAt,
            notes
        };

        transactionsToInsert.push(txDoc);
    }

    // Historical Tx 1: 3 Days ago (MD-X100, 2 boxes)
    createHistoricalTransaction({
        dispatchId: 'DSP202609230001',
        model: m1,
        hoursAgo: 72,
        boxNumbers: [96, 97],
        operatorUsername: 'admin',
        notes: 'Consignment for Mahindra Chakan Plant - Dock 2'
    });

    // Historical Tx 2: 2 Days ago (MD-X200, 2 boxes)
    createHistoricalTransaction({
        dispatchId: 'DSP202609240001',
        model: m2,
        hoursAgo: 48,
        boxNumbers: [197, 198],
        operatorUsername: 'operator1',
        notes: 'Routine morning delivery dispatched on schedule'
    });

    // Historical Tx 3: Yesterday Morning (MD-X300, 2 boxes)
    createHistoricalTransaction({
        dispatchId: 'DSP202609250001',
        model: m3,
        hoursAgo: 26,
        boxNumbers: [297, 298],
        operatorUsername: 'operator1',
        notes: 'Urgent line supply requested for Scorpio assembly line'
    });

    // Historical Tx 4: Yesterday Evening (MD-THAR, 2 boxes)
    createHistoricalTransaction({
        dispatchId: 'DSP202609250002',
        model: m4,
        hoursAgo: 16,
        boxNumbers: [397, 398],
        operatorUsername: 'supervisor1',
        notes: 'Thar Gen-3 trial lot authorized by Shift In-Charge'
    });

    // Historical Tx 5: Today Morning (MD-X100, 4 boxes - large delivery)
    createHistoricalTransaction({
        dispatchId: 'DSP202609260001',
        model: m1,
        hoursAgo: 4,
        boxNumbers: [98, 99, 100, 111],
        operatorUsername: 'admin',
        notes: 'Main weekly bulk order cleared and loaded onto Logistics Bay 4'
    });

    // Insert batches, boxes, events, transactions
    if (batchesToInsert.length > 0) {
        await db.collection('batches').insertMany(batchesToInsert);
    }
    if (boxesToInsert.length > 0) {
        await db.collection('dispatch_boxes').insertMany(boxesToInsert);
    }
    if (eventsToInsert.length > 0) {
        await db.collection('dispatch_box_events').insertMany(eventsToInsert);
    }
    if (transactionsToInsert.length > 0) {
        await db.collection('dispatch_transactions').insertMany(transactionsToInsert);
    }

    // Update global sync state
    await db.collection('sync_states').updateOne(
        { key: 'global_sync' },
        {
            $set: {
                lastSyncedClosedAt: new Date(),
                lastSyncRunAt: new Date(),
                totalSyncedBoxes: boxesToInsert.length
            }
        },
        { upsert: true }
    );

    // 6. Ensure default accounts exist
    const defaultPasswordHash = await bcrypt.hash('pass1234', 10);
    const adminPasswordHash = await bcrypt.hash('admin123', 10);

    const usersToSeed = [
        { username: 'admin', fullName: 'System Administrator', role: 'admin', passwordHash: adminPasswordHash },
        { username: 'operator1', fullName: 'Ramesh Sharma (Operator)', role: 'operator', passwordHash: defaultPasswordHash },
        { username: 'supervisor1', fullName: 'Anita Desai (Supervisor)', role: 'supervisor', passwordHash: defaultPasswordHash },
        { username: 'manager1', fullName: 'Vikram Mehta (Plant Manager)', role: 'manager', passwordHash: defaultPasswordHash }
    ];

    for (const u of usersToSeed) {
        await db.collection('dispatch_users').updateOne(
            { username: u.username },
            { $setOnInsert: { ...u, active: true, createdAt: new Date() } },
            { upsert: true }
        );
    }

    console.log(`[SEED COMPLETED] Seeded:
  - ${DEMO_MODELS.length} Product Models
  - ${boxesToInsert.length} Total Boxes:
      * Available: ${boxesToInsert.filter(b => b.status === 'available').length}
      * On Hold: ${boxesToInsert.filter(b => b.status === 'hold').length}
      * Rejected: ${boxesToInsert.filter(b => b.status === 'rejected').length}
      * Dispatched: ${boxesToInsert.filter(b => b.status === 'dispatched').length}
  - ${transactionsToInsert.length} Historical Dispatch Transactions
  - ${eventsToInsert.length} Box Traceability Lifecycle Events
  - 4 Standard SCADA User Accounts`);

    return {
        modelsCount: DEMO_MODELS.length,
        boxesCount: boxesToInsert.length,
        availableCount: boxesToInsert.filter(b => b.status === 'available').length,
        holdCount: boxesToInsert.filter(b => b.status === 'hold').length,
        rejectedCount: boxesToInsert.filter(b => b.status === 'rejected').length,
        dispatchedCount: boxesToInsert.filter(b => b.status === 'dispatched').length,
        transactionsCount: transactionsToInsert.length,
        eventsCount: eventsToInsert.length
    };
}

module.exports = {
    seedAll,
    DEMO_MODELS
};
