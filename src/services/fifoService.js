// src/services/fifoService.js
const { DispatchBox, DispatchTransaction, BoxLifecycleEvent } = require('../models');
const { generateId } = require('../utils/idGenerator');

/**
 * Plan and initialize a strict FIFO dispatch session
 */
async function planDispatch({ modelId, targetType, targetQuantity, operatorUsername }) {
    if (!modelId || !targetType || !targetQuantity || targetQuantity <= 0) {
        throw new Error('Model, target type (boxes/parts), and positive target quantity are required');
    }

    // Single active transaction constraint
    const activeTx = await DispatchTransaction.findOne({ status: 'in_progress' });
    if (activeTx) {
        if (activeTx.operatorUsername === operatorUsername && activeTx.modelId === modelId) {
            // Return existing active transaction to resume
            return {
                isResumed: true,
                transaction: activeTx,
                message: `Resuming your active dispatch session: ${activeTx.dispatchId}`
            };
        }
        throw new Error(`Another dispatch session (${activeTx.dispatchId}) started by ${activeTx.operatorUsername} is currently active. Complete or cancel it first.`);
    }

    // Query available boxes sorted strictly by closedAt ASC (FIFO)
    const availableBoxes = await DispatchBox.find({
        modelId,
        status: 'available'
    }).sort({ closedAt: 1 });

    if (availableBoxes.length === 0) {
        throw new Error(`No available boxes found for model ${modelId}`);
    }

    const allocated = [];
    let accumulatedCount = 0;

    if (targetType === 'boxes') {
        const requiredBoxes = Math.min(targetQuantity, availableBoxes.length);
        if (availableBoxes.length < targetQuantity) {
            throw new Error(`Insufficient stock: requested ${targetQuantity} boxes, but only ${availableBoxes.length} available`);
        }
        for (let i = 0; i < requiredBoxes; i++) {
            allocated.push(availableBoxes[i]);
            accumulatedCount += availableBoxes[i].completedCount;
        }
    } else if (targetType === 'parts') {
        let partsNeeded = targetQuantity;
        for (const box of availableBoxes) {
            allocated.push(box);
            partsNeeded -= box.completedCount;
            accumulatedCount += box.completedCount;
            if (partsNeeded <= 0) break;
        }

        if (partsNeeded > 0) {
            throw new Error(`Insufficient stock: requested ${targetQuantity} parts, but only ${accumulatedCount} available across all boxes`);
        }
    } else {
        throw new Error(`Invalid target type: ${targetType}. Must be 'boxes' or 'parts'`);
    }

    // Generate unique standardized ID: DSPYYYYMMDD0001
    const dispatchId = await generateId('DSP');

    // Create transaction in 'in_progress'
    const newTransaction = await DispatchTransaction.create({
        dispatchId,
        modelId,
        targetType,
        targetQuantity,
        status: 'in_progress',
        allocatedBoxes: allocated.map(b => ({
            boxId: b._id,
            batchNumber: b.batchNumber,
            completedCount: b.completedCount,
            batchQrData: b.batchQrData,
            closedAt: b.closedAt,
            serialNumbers: b.serialNumbers || []
        })),
        scannedBoxes: [],
        dispatchedBoxCount: allocated.length,
        dispatchedPartCount: accumulatedCount,
        operatorUsername,
        startedAt: new Date()
    });

    // Record allocation event in box lifecycle ledger
    for (const b of allocated) {
        await BoxLifecycleEvent.create({
            boxId: b._id,
            batchNumber: b.batchNumber,
            modelId: b.modelId,
            eventType: 'BOX_ALLOCATED',
            referenceId: dispatchId,
            performedBy: operatorUsername,
            userRole: 'OPERATOR',
            timestamp: new Date(),
            remarks: `Allocated to dispatch session ${dispatchId} (Target: ${targetQuantity} ${targetType})`
        });
    }

    return {
        isResumed: false,
        transaction: newTransaction,
        message: `Dispatch ${dispatchId} started. Pick and scan the ${allocated.length} allocated boxes.`
    };
}

/**
 * Verify a scanned QR payload against the active dispatch transaction
 */
async function verifyScan({ dispatchId, scannedPayload, operatorUsername }) {
    if (!dispatchId || !scannedPayload) {
        throw new Error('Dispatch ID and scanned QR code are required');
    }

    const tx = await DispatchTransaction.findOne({ dispatchId, status: 'in_progress' });
    if (!tx) {
        throw new Error(`No active in-progress dispatch transaction found for ID ${dispatchId}`);
    }

    const trimmedScan = scannedPayload.trim();

    // Check if the scan matches any allocated box
    // Matches by exact batchQrData OR contains serial number OR exact batchNumber
    const matchedBox = tx.allocatedBoxes.find(b => {
        if (b.batchQrData === trimmedScan) return true;
        if (b.batchNumber.toString() === trimmedScan) return true;
        if (trimmedScan.includes(`(${b.batchNumber})`)) return true;
        if (b.serialNumbers && b.serialNumbers.includes(trimmedScan)) return true;
        return false;
    });

    if (matchedBox) {
        // Check if already scanned
        const alreadyScanned = tx.scannedBoxes.some(s => s.boxId.toString() === matchedBox.boxId.toString());
        if (alreadyScanned) {
            return {
                success: false,
                code: 'ALREADY_SCANNED',
                message: `Box #${matchedBox.batchNumber} has already been scanned and verified for this dispatch`,
                progress: {
                    scanned: tx.scannedBoxes.length,
                    total: tx.allocatedBoxes.length,
                    isReady: tx.scannedBoxes.length === tx.allocatedBoxes.length
                }
            };
        }

        // Add to scannedBoxes
        tx.scannedBoxes.push({
            boxId: matchedBox.boxId,
            batchNumber: matchedBox.batchNumber,
            completedCount: matchedBox.completedCount,
            scannedAt: new Date()
        });
        await tx.save();

        // Record lifecycle event
        await BoxLifecycleEvent.create({
            boxId: matchedBox.boxId,
            batchNumber: matchedBox.batchNumber,
            modelId: tx.modelId,
            eventType: 'BOX_SCANNED',
            referenceId: dispatchId,
            performedBy: operatorUsername,
            userRole: 'OPERATOR',
            timestamp: new Date(),
            remarks: `Scanned & verified via terminal for dispatch ${dispatchId}`
        });

        const isComplete = tx.scannedBoxes.length === tx.allocatedBoxes.length;

        return {
            success: true,
            code: 'SCAN_VERIFIED',
            message: `[VERIFIED] Box #${matchedBox.batchNumber} (${matchedBox.completedCount} parts) verified!`,
            box: matchedBox,
            progress: {
                scanned: tx.scannedBoxes.length,
                total: tx.allocatedBoxes.length,
                isReady: isComplete
            }
        };
    }

    // If not in allocated list, investigate reason for informative error:
    const otherBox = await DispatchBox.findOne({
        $or: [
            { batchQrData: trimmedScan },
            { batchNumber: parseInt(trimmedScan, 10) || -1 },
            { serialNumbers: trimmedScan }
        ]
    });

    if (otherBox) {
        if (otherBox.modelId !== tx.modelId) {
            return {
                success: false,
                code: 'WRONG_MODEL',
                message: `WRONG MODEL: Box #${otherBox.batchNumber} belongs to model ${otherBox.modelId}, but this dispatch is for ${tx.modelId}`
            };
        }

        if (otherBox.status === 'hold') {
            return {
                success: false,
                code: 'BOX_ON_HOLD',
                message: `BOX ON HOLD: Box #${otherBox.batchNumber} is currently held (${otherBox.holdReason || 'QA Hold'}). Cannot dispatch!`
            };
        }

        if (otherBox.status === 'rejected') {
            return {
                success: false,
                code: 'BOX_REJECTED',
                message: `BOX REJECTED: Box #${otherBox.batchNumber} is marked REJECTED. Only a Manager can reopen it!`
            };
        }

        if (otherBox.status === 'dispatched') {
            return {
                success: false,
                code: 'ALREADY_DISPATCHED',
                message: `ALREADY DISPATCHED: Box #${otherBox.batchNumber} was already dispatched on ${otherBox.dispatchedAt ? otherBox.dispatchedAt.toISOString().slice(0, 10) : 'prior dispatch'} (${otherBox.dispatchId})`
            };
        }

        if (otherBox.status === 'available') {
            // It's available, but NOT in the allocated FIFO list!
            return {
                success: false,
                code: 'FIFO_VIOLATION',
                message: `FIFO VIOLATION: Box #${otherBox.batchNumber} (closed ${otherBox.closedAt.toISOString().slice(0, 16).replace('T', ' ')}) is newer than the allocated boxes. You must pick the older boxes first!`
            };
        }
    }

    return {
        success: false,
        code: 'INVALID_QR',
        message: 'INVALID QR: Scanned barcode does not correspond to any known box in the database'
    };
}

/**
 * Confirm and finalize a completed dispatch transaction
 */
async function confirmDispatch({ dispatchId, operatorUsername, notes }) {
    const tx = await DispatchTransaction.findOne({ dispatchId, status: 'in_progress' });
    if (!tx) {
        throw new Error(`No active in-progress dispatch transaction found for ID ${dispatchId}`);
    }

    if (tx.scannedBoxes.length !== tx.allocatedBoxes.length) {
        throw new Error(`Cannot confirm dispatch: Only ${tx.scannedBoxes.length} of ${tx.allocatedBoxes.length} boxes have been scanned and verified`);
    }

    const now = new Date();
    const boxIds = tx.allocatedBoxes.map(b => b.boxId);

    // Atomically transition all allocated boxes to 'dispatched'
    await DispatchBox.updateMany(
        { _id: { $in: boxIds } },
        {
            $set: {
                status: 'dispatched',
                dispatchId,
                dispatchedBy: operatorUsername,
                dispatchedAt: now
            }
        }
    );

    // Record lifecycle events
    for (const b of tx.allocatedBoxes) {
        await BoxLifecycleEvent.create({
            boxId: b.boxId,
            batchNumber: b.batchNumber,
            modelId: tx.modelId,
            eventType: 'BOX_DISPATCHED',
            referenceId: dispatchId,
            performedBy: operatorUsername,
            userRole: 'OPERATOR',
            timestamp: now,
            remarks: `Dispatched under transaction ${dispatchId}`
        });
    }

    // Complete transaction
    tx.status = 'completed';
    tx.completedAt = now;
    tx.notes = notes || '';
    await tx.save();

    console.log(`[DISPATCH CONFIRMED] Transaction ${dispatchId} completed (${tx.allocatedBoxes.length} boxes)`);

    return {
        success: true,
        dispatchId,
        message: `Dispatch ${dispatchId} successfully confirmed and completed!`,
        transaction: tx
    };
}

/**
 * Cancel an active dispatch transaction
 */
async function cancelDispatch({ dispatchId, operatorUsername, reason }) {
    const tx = await DispatchTransaction.findOne({ dispatchId, status: 'in_progress' });
    if (!tx) {
        throw new Error(`No active in-progress dispatch transaction found for ID ${dispatchId}`);
    }

    tx.status = 'cancelled';
    tx.cancelledAt = new Date();
    tx.cancellationReason = reason || 'Cancelled by operator';
    await tx.save();

    console.log(`[DISPATCH CANCELLED] Transaction ${dispatchId} cancelled by ${operatorUsername}`);

    return {
        success: true,
        dispatchId,
        message: `Dispatch transaction ${dispatchId} cancelled.`
    };
}

/**
 * Crash recovery: flags any dangling 'in_progress' transactions as 'stale'
 */
async function recoverStaleTransactions() {
    const result = await DispatchTransaction.updateMany(
        { status: 'in_progress' },
        {
            $set: {
                status: 'stale',
                cancelledAt: new Date(),
                cancellationReason: 'Application closed or restarted before transaction was completed'
            }
        }
    );

    if (result.modifiedCount > 0) {
        console.log(`[STALE RECOVERY] Marked ${result.modifiedCount} dangling in_progress transactions as STALE`);
    }
}

module.exports = {
    planDispatch,
    verifyScan,
    confirmDispatch,
    cancelDispatch,
    recoverStaleTransactions
};
