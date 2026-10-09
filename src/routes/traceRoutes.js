// src/routes/traceRoutes.js
const express = require('express');
const router = express.Router();
const { DispatchBox, BoxLifecycleEvent, ProductModel, DispatchUser } = require('../models');
const { authenticate } = require('../middleware/authMiddleware');

// GET /api/trace/:query - End-to-end box lifecycle traceability lookup
router.get('/:query', authenticate, async (req, res) => {
    try {
        const { getStatus } = require('../config/db');
        if (!getStatus().isConnected) {
            return res.status(503).json({
                success: false,
                error: 'Database is offline (Safe Mode). Traceability lookup requires database connection.'
            });
        }

        const query = req.params.query.trim();
        const stripAsterisks = (s) => (s || '').replace(/^\*+|\*+$/g, '').trim();
        const cleanQuery = stripAsterisks(query);
        const escapedQuery = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Strictly search by 2D DataMatrix QR payload (batchQrData)
        const orConditions = [
            { batchQrData: query },
            { batchQrData: cleanQuery },
            { batchQrData: `*${cleanQuery}*` },
            { batchQrData: { $regex: escapedQuery, $options: 'i' } }
        ];

        const box = await DispatchBox.findOne({ $or: orConditions });

        if (!box) {
            return res.status(404).json({
                success: false,
                error: `No box found matching 2D DataMatrix QR payload '${query}'. Please scan or paste a valid 2D DataMatrix QR barcode string.`
            });
        }

        // Fetch model details
        const model = await ProductModel.findOne({ modelId: box.modelId });

        // Fetch chronological lifecycle events
        const events = await BoxLifecycleEvent.find({ boxId: box._id }).sort({ timestamp: 1 });

        // Resolve usernames to full names
        const usernames = [...new Set(events.map(e => (e.performedBy || '').trim()).filter(Boolean))];
        const users = await DispatchUser.find({ username: { $in: usernames.map(u => u.toLowerCase()) } }).select('username fullName').lean();
        const userMap = {};
        users.forEach(u => {
            if (u.username) userMap[u.username.toLowerCase()] = u.fullName;
        });

        const resolveFullName = (username) => {
            if (!username) return 'System';
            const lower = username.toLowerCase();
            if (lower === 'system_sync' || lower === 'system') return 'System Automation';
            if (userMap[lower]) return userMap[lower];
            // Format title-case words if not in DB (e.g. 'supervisor_qa' -> 'Supervisor QA')
            return username.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        };

        res.json({
            success: true,
            box: {
                id: box._id,
                batchNumber: box.batchNumber,
                modelId: box.modelId,
                modelName: model ? model.modelName : box.modelId,
                customerPartNo: model ? model.customerPartNo : 'N/A',
                customerName: model ? model.customerName : 'Mahindra & Mahindra Powertrain',
                internalPartId: model ? model.internalPartId : 'N/A',
                machineNo: box.machineNo,
                shiftCode: box.shiftCode,
                batchDate: box.batchDate,
                batchSize: box.batchSize,
                completedCount: box.completedCount,
                batchQrData: box.batchQrData,
                closedAt: box.closedAt,
                status: box.status,
                holdInfo: box.holdId ? {
                    holdId: box.holdId,
                    reason: box.holdReason,
                    remarks: box.holdRemarks,
                    heldBy: box.heldBy,
                    heldAt: box.heldAt,
                    releasedBy: box.holdReleasedBy,
                    releasedAt: box.holdReleasedAt
                } : null,
                rejectionInfo: box.rejectionId ? {
                    rejectionId: box.rejectionId,
                    reason: box.rejectionReason,
                    remarks: box.rejectionRemarks,
                    rejectedBy: box.rejectedBy,
                    rejectedAt: box.rejectedAt,
                    reopenedBy: box.reopenedBy,
                    reopenedAt: box.reopenedAt,
                    reopenRemarks: box.reopenRemarks
                } : null,
                dispatchInfo: box.dispatchId ? {
                    dispatchId: box.dispatchId,
                    dispatchedBy: box.dispatchedBy,
                    dispatchedAt: box.dispatchedAt
                } : null,
                serialNumbers: box.serialNumbers
            },
            timeline: events.map(e => ({
                id: e._id,
                eventType: e.eventType,
                referenceId: e.referenceId,
                performedBy: e.performedBy,
                performedByName: resolveFullName(e.performedBy),
                userRole: e.userRole,
                timestamp: e.timestamp,
                reason: e.reason,
                remarks: e.remarks
            }))
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
