// src/routes/boxRoutes.js
const express = require('express');
const router = express.Router();
const { DispatchBox, ProductModel, BoxLifecycleEvent } = require('../models');
const { authenticate, requireRole } = require('../middleware/authMiddleware');
const { generateId } = require('../utils/idGenerator');

// GET /api/boxes - Query box inventory with multi-filtering
router.get('/', authenticate, async (req, res) => {
    try {
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
            const num = parseInt(search, 10);
            if (!isNaN(num)) {
                filter.$or = [
                    { batchNumber: num },
                    { batchQrData: { $regex: search, $options: 'i' } }
                ];
            } else {
                filter.batchQrData = { $regex: search, $options: 'i' };
            }
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const [boxes, total] = await Promise.all([
            DispatchBox.find(filter).sort({ closedAt: -1 }).skip(skip).limit(parseInt(limit, 10)),
            DispatchBox.countDocuments(filter)
        ]);

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

// POST /api/boxes/:id/hold - Mark box on hold (Supervisor and above)
router.post('/:id/hold', authenticate, requireRole('supervisor'), async (req, res) => {
    try {
        const { reason, remarks } = req.body;
        if (!reason) {
            return res.status(400).json({ success: false, error: 'Hold reason is required' });
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
        if (!reason) {
            return res.status(400).json({ success: false, error: 'Rejection reason is required' });
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
                error: 'Mandatory Manager remarks required (minimum 5 characters) to authorize reopening a rejected box.'
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
