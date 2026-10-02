// src/routes/traceRoutes.js
const express = require('express');
const router = express.Router();
const { DispatchBox, BoxLifecycleEvent, ProductModel, DispatchUser } = require('../models');
const { authenticate } = require('../middleware/authMiddleware');

// GET /api/trace/:query - End-to-end box lifecycle traceability lookup
router.get('/:query', authenticate, async (req, res) => {
    try {
        const query = req.params.query.trim();
        // Support searching by raw input, as well as stripped "BOX #1001", "#1001", "BOX 1001"
        const cleanBoxStr = query.replace(/^(BOX\s*#?|#)\s*/i, '').trim();
        const num = /^\d+$/.test(cleanBoxStr) ? parseInt(cleanBoxStr, 10) : null;

        const orConditions = [
            { batchQrData: query },
            { serialNumbers: query }
        ];

        if (cleanBoxStr && cleanBoxStr !== query) {
            orConditions.push({ batchQrData: cleanBoxStr });
            orConditions.push({ serialNumbers: cleanBoxStr });
        }

        if (num !== null) {
            orConditions.push({ batchNumber: num });
        }

        const box = await DispatchBox.findOne({ $or: orConditions });

        if (!box) {
            return res.status(404).json({
                success: false,
                error: `No box found matching '${query}' (Search by Box No., Serial No., or QR payload)`
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
