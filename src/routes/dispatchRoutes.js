// src/routes/dispatchRoutes.js
const express = require('express');
const router = express.Router();
const { DispatchTransaction, ProductModel, SystemSettings } = require('../models');
const { authenticate } = require('../middleware/authMiddleware');
const fifoService = require('../services/fifoService');

// GET /api/dispatch/active - Check for currently active in_progress dispatch session
router.get('/active', authenticate, async (req, res) => {
    try {
        const activeTx = await DispatchTransaction.findOne({ status: 'in_progress' });
        res.json({ success: true, activeTransaction: activeTx || null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/dispatch/plan - Start a new dispatch session or resume existing
router.post('/plan', authenticate, async (req, res) => {
    try {
        const { modelId, targetType, targetQuantity } = req.body;
        const result = await fifoService.planDispatch({
            modelId,
            targetType,
            targetQuantity: parseInt(targetQuantity, 10),
            operatorUsername: req.user.username
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// POST /api/dispatch/scan - Verify scanned QR code
router.post('/scan', authenticate, async (req, res) => {
    try {
        const { dispatchId, scannedPayload } = req.body;
        const result = await fifoService.verifyScan({
            dispatchId,
            scannedPayload,
            operatorUsername: req.user.username
        });
        res.json({ success: result.success, ...result });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// POST /api/dispatch/confirm - Confirm completed dispatch
router.post('/confirm', authenticate, async (req, res) => {
    try {
        const { dispatchId, notes } = req.body;
        const result = await fifoService.confirmDispatch({
            dispatchId,
            operatorUsername: req.user.username,
            notes
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// POST /api/dispatch/cancel - Cancel active dispatch
router.post('/cancel', authenticate, async (req, res) => {
    try {
        const { dispatchId, reason } = req.body;
        const result = await fifoService.cancelDispatch({
            dispatchId,
            operatorUsername: req.user.username,
            reason
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// GET /api/dispatch/bill/:id - Detailed Delivery Challan / Dispatch Bill View
router.get('/bill/:id', authenticate, async (req, res) => {
    try {
        const dispatchId = req.params.id;
        const tx = await DispatchTransaction.findOne({ dispatchId });
        if (!tx) {
            return res.status(404).json({ success: false, error: 'Dispatch transaction not found' });
        }

        // Fetch model metadata from productmodels
        const model = await ProductModel.findOne({ modelId: tx.modelId }) || {
            modelId: tx.modelId,
            modelName: tx.modelId,
            customerPartNo: 'N/A',
            internalPartId: 'N/A',
            productRevNo: 'N/A',
            softwareRevNo: 'N/A',
            customerName: 'Mahindra'
        };

        const settings = await SystemSettings.findOne({ key: 'global_settings' }) || {
            companyName: 'Elektrosil',
            customerName: 'Mahindra'
        };

        res.json({
            success: true,
            bill: {
                dispatchId: tx.dispatchId,
                status: tx.status,
                startedAt: tx.startedAt,
                completedAt: tx.completedAt,
                operatorUsername: tx.operatorUsername,
                modelId: tx.modelId,
                modelName: model.modelName,
                customerPartNo: model.customerPartNo,
                internalPartId: model.internalPartId,
                productRevNo: model.productRevNo,
                softwareRevNo: model.softwareRevNo,
                customerName: model.customerName || settings.customerName,
                companyName: settings.companyName,
                totalBoxes: tx.allocatedBoxes.length,
                totalParts: tx.dispatchedPartCount,
                notes: tx.notes || '',
                boxes: tx.allocatedBoxes.map(b => ({
                    boxId: b.boxId,
                    batchNumber: b.batchNumber,
                    completedCount: b.completedCount,
                    batchQrData: b.batchQrData,
                    closedAt: b.closedAt,
                    serialNumbers: b.serialNumbers || []
                }))
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
