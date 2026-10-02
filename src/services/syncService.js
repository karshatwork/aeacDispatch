// src/services/syncService.js
const { Batch, DispatchBox, SyncState, BoxLifecycleEvent } = require('../models');

let isRunning = false;
let syncTimer = null;

/**
 * Initialize or get existing sync state
 */
async function getOrCreateSyncState() {
    let state = await SyncState.findOne({ key: 'global_sync' });
    if (!state) {
        // Initialize watermark to CURRENT DATE/TIME on first load
        const now = new Date();
        state = await SyncState.create({
            key: 'global_sync',
            lastSyncedClosedAt: now,
            lastBatchNumber: null,
            totalSyncedBoxes: 0,
            isInitialized: true
        });
        console.log(`[SYNC INIT] Initialized sync watermark to current time: ${now.toISOString()}`);
    }
    return state;
}

/**
 * Single sync pass: queries closed batches with closedAt > lastSyncedClosedAt
 */
async function performSync() {
    if (isRunning) return { processed: 0, message: 'Sync already running' };
    isRunning = true;

    try {
        const state = await getOrCreateSyncState();
        const watermark = state.lastSyncedClosedAt;

        // Query closed batches strictly newer than watermark
        const newClosedBatches = await Batch.find({
            status: 'closed',
            closedAt: { $gt: watermark }
        }).sort({ closedAt: 1 }).limit(100);

        if (newClosedBatches.length === 0) {
            isRunning = false;
            return { processed: 0, watermark };
        }

        let processedCount = 0;
        let highestClosedAt = watermark;
        let lastBatchNum = state.lastBatchNumber;

        for (const batch of newClosedBatches) {
            if (!batch.closedAt) continue;

            // Check if already in dispatch_boxes by batchId OR by batchQrData (idempotent)
            const orConditions = [{ batchId: batch._id }];
            if (batch.batchQrData) {
                orConditions.push({ batchQrData: batch.batchQrData });
            }
            const existing = await DispatchBox.findOne({ $or: orConditions });
            if (!existing) {
                const newBox = await DispatchBox.create({
                    batchId: batch._id,
                    batchNumber: batch.batchNumber,
                    modelId: batch.modelId,
                    machineNo: batch.machineNo,
                    shiftCode: batch.shiftCode || '1A',
                    batchDate: batch.batchDate || new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
                    batchSize: batch.batchSize,
                    completedCount: batch.completedCount || batch.batchSize,
                    serialNumbers: batch.serialNumbers || [],
                    batchQrData: batch.batchQrData || `*DEFAULT|${batch.modelId}|${batch.batchNumber}*`,
                    closedAt: batch.closedAt,
                    status: 'available'
                });

                // Record immutable lifecycle event
                await BoxLifecycleEvent.create({
                    boxId: newBox._id,
                    batchNumber: newBox.batchNumber,
                    modelId: newBox.modelId,
                    eventType: 'BOX_INGESTED',
                    performedBy: 'SYSTEM_SYNC',
                    userRole: 'SYSTEM',
                    timestamp: new Date(),
                    remarks: `Ingested from production batch closed at ${batch.closedAt.toISOString()}`
                });

                processedCount++;
            }

            if (batch.closedAt > highestClosedAt) {
                highestClosedAt = batch.closedAt;
            }
            if (batch.batchNumber) {
                lastBatchNum = batch.batchNumber;
            }
        }

        // Advance watermark
        state.lastSyncedClosedAt = highestClosedAt;
        state.lastBatchNumber = lastBatchNum;
        state.lastSyncRunAt = new Date();
        state.totalSyncedBoxes += processedCount;
        await state.save();

        if (processedCount > 0) {
            console.log(`[SYNC] Ingested ${processedCount} new boxes. New watermark: ${highestClosedAt.toISOString()}`);
        }

        isRunning = false;
        return { processed: processedCount, watermark: highestClosedAt };
    } catch (err) {
        isRunning = false;
        console.error(`[SYNC ERROR] ${err.message}`);
        throw err;
    }
}

/**
 * Manual historical batch re-sync for managers
 * Allows backfilling batches closed within a custom date range
 */
async function manualHistoricalSync(startDate, endDate, performedBy = 'MANAGER') {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const batches = await Batch.find({
        status: 'closed',
        closedAt: { $gte: start, $lte: end }
    }).sort({ closedAt: 1 });

    let backfilledCount = 0;

    for (const batch of batches) {
        if (!batch.closedAt) continue;

        const orConditions = [{ batchId: batch._id }];
        if (batch.batchQrData) {
            orConditions.push({ batchQrData: batch.batchQrData });
        }
        const existing = await DispatchBox.findOne({ $or: orConditions });
        if (!existing) {
            const newBox = await DispatchBox.create({
                batchId: batch._id,
                batchNumber: batch.batchNumber,
                modelId: batch.modelId,
                machineNo: batch.machineNo,
                shiftCode: batch.shiftCode || '1A',
                batchDate: batch.batchDate || new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
                batchSize: batch.batchSize,
                completedCount: batch.completedCount || batch.batchSize,
                serialNumbers: batch.serialNumbers || [],
                batchQrData: batch.batchQrData || `*DEFAULT|${batch.modelId}|${batch.batchNumber}*`,
                closedAt: batch.closedAt,
                status: 'available'
            });

            await BoxLifecycleEvent.create({
                boxId: newBox._id,
                batchNumber: newBox.batchNumber,
                modelId: newBox.modelId,
                eventType: 'BOX_INGESTED',
                performedBy: performedBy,
                userRole: 'MANAGER',
                timestamp: new Date(),
                remarks: `Manual historical re-sync for range ${startDate} to ${endDate}`
            });

            backfilledCount++;
        }
    }

    return {
        totalFound: batches.length,
        backfilledCount,
        message: `Historical sync complete: found ${batches.length} closed batches, backfilled ${backfilledCount} new boxes.`
    };
}

/**
 * Start recurring sync loop
 */
function startSyncWorker(intervalMs = 300000) { // 5 minutes default (300,000 ms)
    if (syncTimer) clearInterval(syncTimer);
    console.log(`[SYNC WORKER] Started background watcher (every ${intervalMs}ms)`);
    performSync().catch(err => console.error('[SYNC WORKER INITIAL FAILED]', err.message));
    syncTimer = setInterval(() => {
        performSync().catch(err => console.error('[SYNC WORKER TICK FAILED]', err.message));
    }, intervalMs);
}

function stopSyncWorker() {
    if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
        console.log('[SYNC WORKER] Stopped');
    }
}

module.exports = {
    getOrCreateSyncState,
    performSync,
    manualHistoricalSync,
    startSyncWorker,
    stopSyncWorker
};
