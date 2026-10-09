// src/routes/boxRoutes.js
const express = require('express');
const router = express.Router();
const { DispatchBox, ProductModel, BoxLifecycleEvent } = require('../models');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { generateId } = require('../utils/idGenerator');

// Escape special regex characters to prevent MongoDB regex compilation crashes or unexpected operator matching
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Smart search filter for Box Inventory (QR codes, Box #, Serials, IDs, Remarks)
function buildSearchFilter(search) {
    if (!search) return null;
    const raw = search.trim();
    if (!raw) return null;

    const orConditions = [];

    // 1. Full QR Code Handling (exact and asterisk-normalized)
    const strippedAsterisks = raw.replace(/^\*+|\*+$/g, '').trim();
    const wrappedAsterisks = `*${strippedAsterisks}*`;

    orConditions.push({ batchQrData: raw });
    if (strippedAsterisks !== raw) {
        orConditions.push({ batchQrData: strippedAsterisks });
        orConditions.push({ batchQrData: wrappedAsterisks });
    }

    // 2. Safe Escaped Regex Substring on batchQrData
    const escaped = escapeRegex(raw);
    const escapedStripped = escapeRegex(strippedAsterisks);
    orConditions.push({ batchQrData: { $regex: escaped, $options: 'i' } });
    if (escapedStripped !== escaped) {
        orConditions.push({ batchQrData: { $regex: escapedStripped, $options: 'i' } });
    }

    // 3. QR Code payload decomposition if pipes (|) are present:
    // e.g. *DEFAULT|M001|1001* or DEFAULT|M001|1001 or SUP01|MD-X100|1A(101)
    if (strippedAsterisks.includes('|')) {
        const parts = strippedAsterisks.split('|').map(p => p.trim());
        const lastPart = parts[parts.length - 1];
        const numMatch = lastPart.match(/\d+/);
        if (numMatch) {
            const parsedNum = parseInt(numMatch[0], 10);
            if (!isNaN(parsedNum)) {
                const candidateModel = parts.find(p => /^[A-Za-z0-9_-]{2,15}$/.test(p) && !/^\d+$/.test(p) && p !== 'DEFAULT');
                if (candidateModel) {
                    orConditions.push({ modelId: candidateModel, batchNumber: parsedNum });
                } else {
                    orConditions.push({ batchNumber: parsedNum });
                }
            }
        }
    }

    // 4. Box / Batch Number detection (e.g. "1001", "BOX #1001", "BOX 1001", "#1001")
    const cleanBoxStr = raw.replace(/^(BOX\s*#?|#|B#|BOX-)\s*/i, '').trim();
    if (/^\d+$/.test(cleanBoxStr)) {
        const boxNum = parseInt(cleanBoxStr, 10);
        if (!isNaN(boxNum)) {
            orConditions.push({ batchNumber: boxNum });
        }
    }

    // 5. Serial Numbers (exact or escaped regex)
    orConditions.push({ serialNumbers: raw });
    orConditions.push({ serialNumbers: { $regex: escaped, $options: 'i' } });

    // 6. Reference IDs (Hold ID, Rejection ID, Dispatch ID)
    orConditions.push({ holdId: { $regex: escaped, $options: 'i' } });
    orConditions.push({ rejectionId: { $regex: escaped, $options: 'i' } });
    orConditions.push({ dispatchId: { $regex: escaped, $options: 'i' } });

    // 7. Model ID exact match if query looks like model identifier (e.g. M001)
    if (/^[A-Za-z0-9_-]{2,15}$/.test(raw) && !/^\d+$/.test(raw) && !raw.includes('|')) {
        orConditions.push({ modelId: { $regex: `^${escaped}$`, $options: 'i' } });
    }

    // 8. General Remarks / Reason search:
    // Only search reason fields if the query is a descriptive keyword (not a QR code, box #, or serial)
    if (!raw.includes('|') && !raw.includes('*') && !/^\d+$/.test(cleanBoxStr) && raw.length >= 3) {
        orConditions.push({ holdReason: { $regex: escaped, $options: 'i' } });
        orConditions.push({ rejectionReason: { $regex: escaped, $options: 'i' } });
        orConditions.push({ holdRemarks: { $regex: escaped, $options: 'i' } });
        orConditions.push({ rejectionRemarks: { $regex: escaped, $options: 'i' } });
    }

    return orConditions.length > 0 ? { $or: orConditions } : null;
}

// GET /api/boxes - Query box inventory with multi-filtering
router.get('/', authenticate, async (req, res) => {
    try {
        const { getStatus } = require('../config/db');
        if (!getStatus().isConnected) {
            return res.json({
                success: true,
                boxes: [],
                total: 0,
                page: 1,
                pages: 0,
                offline: true
            });
        }

        const { modelId, status, dateFrom, dateTo, search, page = 1, limit = 50 } = req.query;
        const filter = {};

        if (modelId && modelId !== 'ALL') filter.modelId = modelId;
        if (status && status !== 'ALL') filter.status = status;
        
        if (dateFrom || dateTo) {
            filter.closedAt = {};
            if (dateFrom) filter.closedAt.$gte = new Date(dateFrom);
            if (dateTo) filter.closedAt.$lte = new Date(new Date(dateTo).setHours(23, 59, 59, 999));
        }

        if (search) {
            const searchFilter = buildSearchFilter(search);
            if (searchFilter) Object.assign(filter, searchFilter);
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const [rawBoxes, total, productModels] = await Promise.all([
            DispatchBox.find(filter).sort({ closedAt: -1 }).skip(skip).limit(parseInt(limit, 10)).lean(),
            DispatchBox.countDocuments(filter),
            ProductModel.find({}).lean()
        ]);

        const modelMap = {};
        (productModels || []).forEach(m => { modelMap[m.modelId] = m.modelName; });

        const boxes = rawBoxes.map(b => ({
            ...b,
            modelName: modelMap[b.modelId] || b.modelId
        }));

        res.json({
            success: true,
            boxes,
            total,
            page: parseInt(page, 10),
            pages: Math.ceil(total / parseInt(limit, 10))
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/boxes/models - Get list of models and available stock counts
router.get('/models', authenticate, async (req, res) => {
    try {
        const { getStatus } = require('../config/db');
        if (!getStatus().isConnected) {
            return res.json({ success: true, models: [] });
        }

        // Query read-only ProductModels from production DB
        const models = await ProductModel.find({ active: true }).sort({ modelId: 1 });

        // Calculate available stock count for each model
        const stockAgg = await DispatchBox.aggregate([
            { $match: { status: 'available' } },
            {
                $group: {
                    _id: '$modelId',
                    boxCount: { $sum: 1 },
                    totalParts: { $sum: '$completedCount' }
                }
            }
        ]);

        const stockMap = {};
        for (const item of stockAgg) {
            stockMap[item._id] = { boxCount: item.boxCount, totalParts: item.totalParts };
        }

        const result = models.map(m => ({
            modelId: m.modelId,
            modelName: m.modelName,
            customerPartNo: m.customerPartNo,
            internalPartId: m.internalPartId,
            batchSize: m.batchSize,
            availableBoxes: stockMap[m.modelId] ? stockMap[m.modelId].boxCount : 0,
            availableParts: stockMap[m.modelId] ? stockMap[m.modelId].totalParts : 0
        }));

        res.json({ success: true, models: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/boxes/export-csv - Download current inventory as CSV (same filters as main list)
router.get('/export-csv', authenticate, requireRole('supervisor'), async (req, res) => {
    try {
        const { modelId, status, dateFrom, dateTo, search } = req.query;
        const filter = {};

        if (modelId && modelId !== 'ALL') filter.modelId = modelId;
        if (status && status !== 'ALL') filter.status = status;

        if (dateFrom || dateTo) {
            filter.closedAt = {};
            if (dateFrom) filter.closedAt.$gte = new Date(dateFrom);
            if (dateTo) filter.closedAt.$lte = new Date(new Date(dateTo).setHours(23, 59, 59, 999));
        }

        if (search) {
            const searchFilter = buildSearchFilter(search);
            if (searchFilter) Object.assign(filter, searchFilter);
        }

        const boxes = await DispatchBox.find(filter).sort({ closedAt: -1 });

        const csvRows = ['Sticker Code,Model,Machine,Produced At,Quantity,Batch Size,Status,Reference ID,Remarks,Part Serials'];
        for (const b of boxes) {
            const producedAt = b.closedAt ? b.closedAt.toISOString().slice(0, 16).replace('T', ' ') : '';
            const refId = b.holdId || b.rejectionId || b.dispatchId || '';
            const stickerCode = b.shiftCode && b.batchNumber ? `${b.shiftCode}(${b.batchNumber})` : (b.batchNumber ? `1A(${b.batchNumber})` : '');
            
            let remarksVal = '';
            if (b.status === 'dispatched') {
                remarksVal = b.dispatchedAt ? b.dispatchedAt.toISOString().slice(0, 19).replace('T', ' ') : (b.updatedAt ? b.updatedAt.toISOString().slice(0, 19).replace('T', ' ') : '');
            } else if (b.status === 'hold' || b.status === 'rejected') {
                const reason = b.holdReason || b.rejectionReason || '';
                const rawRem = b.holdRemarks || b.rejectionRemarks || b.reopenRemarks || '';
                if (reason && rawRem) remarksVal = `${reason}: ${rawRem}`;
                else if (reason) remarksVal = reason;
                else remarksVal = rawRem;
            }

            const partSerials = (b.serialNumbers && b.serialNumbers.length) ? b.serialNumbers.join(';') : '';
            csvRows.push([
                `"${stickerCode}"`,
                `"${(b.modelId || '').replace(/"/g, '""')}"`,
                b.machineNo || '',
                producedAt,
                b.completedCount || 0,
                b.batchSize || 0,
                b.status || '',
                `"${refId.replace(/"/g, '""')}"`,
                `"${remarksVal.replace(/"/g, '""')}"`,
                `"${partSerials.replace(/"/g, '""')}"`
            ].join(','));
        }

        res.header('Content-Type', 'text/csv');
        res.attachment(`box_inventory_${new Date().toISOString().slice(0, 10)}.csv`);
        res.send(csvRows.join('\r\n'));
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/boxes/:id/hold - Mark box on hold (Supervisor and above)
router.post('/:id/hold', authenticate, requireRole('supervisor'), async (req, res) => {
    try {
        const { reason, remarks } = req.body;
        if (!reason || typeof reason !== 'string' || !reason.trim()) {
            return res.status(400).json({ success: false, error: 'Hold reason is required' });
        }
        if (!remarks || typeof remarks !== 'string' || !remarks.trim()) {
            return res.status(400).json({ success: false, error: 'Supervisor remarks are mandatory' });
        }

        const box = await DispatchBox.findById(req.params.id);
        if (!box) {
            return res.status(404).json({ success: false, error: 'Box not found' });
        }

        if (box.status === 'dispatched') {
            return res.status(400).json({ success: false, error: 'Cannot put an already dispatched box on hold' });
        }

        const holdId = await generateId('HLD');
        const now = new Date();

        box.status = 'hold';
        box.holdId = holdId;
        box.holdReason = reason;
        box.holdRemarks = remarks || '';
        box.heldBy = req.user.username;
        box.heldAt = now;
        await box.save();

        await BoxLifecycleEvent.create({
            boxId: box._id,
            batchNumber: box.batchNumber,
            modelId: box.modelId,
            eventType: 'BOX_HELD',
            referenceId: holdId,
            performedBy: req.user.username,
            userRole: req.user.role,
            timestamp: now,
            reason,
            remarks: remarks || ''
        });

        res.json({ success: true, message: `Box #${box.batchNumber} marked ON HOLD (${holdId})`, box });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/boxes/:id/release-hold - Release hold (Supervisor and above)
router.post('/:id/release-hold', authenticate, requireRole('supervisor'), async (req, res) => {
    try {
        const { remarks } = req.body;
        const box = await DispatchBox.findById(req.params.id);
        if (!box) {
            return res.status(404).json({ success: false, error: 'Box not found' });
        }

        if (box.status !== 'hold') {
            return res.status(400).json({ success: false, error: `Box is currently in status '${box.status}', not 'hold'` });
        }

        const now = new Date();
        box.status = 'available';
        box.holdReleasedBy = req.user.username;
        box.holdReleasedAt = now;
        await box.save();

        await BoxLifecycleEvent.create({
            boxId: box._id,
            batchNumber: box.batchNumber,
            modelId: box.modelId,
            eventType: 'BOX_HOLD_RELEASED',
            referenceId: box.holdId,
            performedBy: req.user.username,
            userRole: req.user.role,
            timestamp: now,
            remarks: remarks || `Released from hold by ${req.user.username}`
        });

        res.json({ success: true, message: `Hold released for Box #${box.batchNumber}. Returned to AVAILABLE.`, box });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/boxes/:id/reject - Mark box rejected (Supervisor and above)
router.post('/:id/reject', authenticate, requireRole('supervisor'), async (req, res) => {
    try {
        const { reason, remarks } = req.body;
        if (!reason || typeof reason !== 'string' || !reason.trim()) {
            return res.status(400).json({ success: false, error: 'Rejection reason is required' });
        }
        if (!remarks || typeof remarks !== 'string' || !remarks.trim()) {
            return res.status(400).json({ success: false, error: 'Rejection remarks are mandatory' });
        }

        const box = await DispatchBox.findById(req.params.id);
        if (!box) {
            return res.status(404).json({ success: false, error: 'Box not found' });
        }

        if (box.status === 'dispatched') {
            return res.status(400).json({ success: false, error: 'Cannot reject an already dispatched box' });
        }

        const rejectionId = await generateId('REJ');
        const now = new Date();

        box.status = 'rejected';
        box.rejectionId = rejectionId;
        box.rejectionReason = reason;
        box.rejectionRemarks = remarks || '';
        box.rejectedBy = req.user.username;
        box.rejectedAt = now;
        await box.save();

        await BoxLifecycleEvent.create({
            boxId: box._id,
            batchNumber: box.batchNumber,
            modelId: box.modelId,
            eventType: 'BOX_REJECTED',
            referenceId: rejectionId,
            performedBy: req.user.username,
            userRole: req.user.role,
            timestamp: now,
            reason,
            remarks: remarks || ''
        });

        res.json({ success: true, message: `Box #${box.batchNumber} marked REJECTED (${rejectionId})`, box });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/boxes/:id/reopen - Reopen rejected box (STRICTLY Manager and above)
router.post('/:id/reopen', authenticate, requireRole('manager'), async (req, res) => {
    try {
        const { remarks } = req.body;
        if (!remarks || remarks.trim().length < 5) {
            return res.status(400).json({
                success: false,
                error: 'Mandatory remarks required (minimum 5 characters) to authorize reopening a rejected box.'
            });
        }

        const box = await DispatchBox.findById(req.params.id);
        if (!box) {
            return res.status(404).json({ success: false, error: 'Box not found' });
        }

        if (box.status !== 'rejected') {
            return res.status(400).json({ success: false, error: `Box is currently '${box.status}', not 'rejected'` });
        }

        const now = new Date();
        box.status = 'available';
        box.reopenedBy = req.user.username;
        box.reopenedAt = now;
        box.reopenRemarks = remarks;
        await box.save();

        await BoxLifecycleEvent.create({
            boxId: box._id,
            batchNumber: box.batchNumber,
            modelId: box.modelId,
            eventType: 'BOX_REJECT_REOPENED',
            referenceId: box.rejectionId,
            performedBy: req.user.username,
            userRole: req.user.role,
            timestamp: now,
            remarks: `Reopened by Manager ${req.user.username}: ${remarks}`
        });

        res.json({
            success: true,
            message: `Box #${box.batchNumber} reopened by Manager ${req.user.username}. Returned to AVAILABLE.`,
            box
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
