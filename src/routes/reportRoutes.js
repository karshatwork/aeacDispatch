// src/routes/reportRoutes.js
const express = require('express');
const router = express.Router();
const { DispatchTransaction, DispatchBox } = require('../models');
const { authenticate, requireRole } = require('../middleware/authMiddleware');

// GET /api/reports/monthly - Monthly summary metrics & offline chart data
router.get('/monthly', authenticate, requireRole('supervisor'), async (req, res) => {
    try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        // Dispatches completed this month
        const monthlyTxs = await DispatchTransaction.find({
            status: 'completed',
            completedAt: { $gte: startOfMonth, $lte: endOfMonth }
        });

        let dispatchedThisMonthBoxes = 0;
        let dispatchedThisMonthParts = 0;
        const dailyMap = {};
        const modelMap = {};

        for (const tx of monthlyTxs) {
            dispatchedThisMonthBoxes += tx.allocatedBoxes.length;
            dispatchedThisMonthParts += tx.dispatchedPartCount;

            const dayKey = tx.completedAt.toISOString().slice(0, 10);
            dailyMap[dayKey] = (dailyMap[dayKey] || 0) + tx.allocatedBoxes.length;

            modelMap[tx.modelId] = (modelMap[tx.modelId] || 0) + tx.allocatedBoxes.length;
        }

        // Active boxes currently on hold
        const activeHoldBoxes = await DispatchBox.countDocuments({ status: 'hold' });

        // Boxes rejected this month
        const rejectedThisMonthBoxes = await DispatchBox.countDocuments({
            status: 'rejected',
            rejectedAt: { $gte: startOfMonth, $lte: endOfMonth }
        });

        // Format daily chart data
        const daysInMonth = endOfMonth.getDate();
        const dailyLabels = [];
        const dailyData = [];

        for (let d = 1; d <= daysInMonth; d++) {
            const dayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            dailyLabels.push(String(d).padStart(2, '0'));
            dailyData.push(dailyMap[dayStr] || 0);
        }

        // Format model distribution chart data
        const modelLabels = Object.keys(modelMap);
        const modelData = Object.values(modelMap);

        res.json({
            success: true,
            metrics: {
                dispatchedThisMonthBoxes,
                dispatchedThisMonthParts,
                activeHoldBoxes,
                rejectedThisMonthBoxes,
                monthName: now.toLocaleString('default', { month: 'long', year: 'numeric' })
            },
            charts: {
                daily: { labels: dailyLabels, data: dailyData },
                models: { labels: modelLabels, data: modelData }
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/reports/history - Historical transactions
router.get('/history', authenticate, requireRole('supervisor'), async (req, res) => {
    try {
        const { dateFrom, dateTo, modelId, page = 1, limit = 20 } = req.query;
        const filter = { status: 'completed' };

        if (modelId && modelId !== 'ALL') filter.modelId = modelId;
        if (dateFrom || dateTo) {
            filter.completedAt = {};
            if (dateFrom) filter.completedAt.$gte = new Date(dateFrom);
            if (dateTo) filter.completedAt.$lte = new Date(new Date(dateTo).setHours(23, 59, 59, 999));
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const [transactions, total] = await Promise.all([
            DispatchTransaction.find(filter).sort({ completedAt: -1 }).skip(skip).limit(parseInt(limit, 10)),
            DispatchTransaction.countDocuments(filter)
        ]);

        res.json({
            success: true,
            transactions,
            total,
            page: parseInt(page, 10),
            pages: Math.ceil(total / parseInt(limit, 10))
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/reports/export-csv - Downloadable CSV report
router.get('/export-csv', authenticate, requireRole('supervisor'), async (req, res) => {
    try {
        const { dateFrom, dateTo } = req.query;
        const filter = { status: 'completed' };

        if (dateFrom || dateTo) {
            filter.completedAt = {};
            if (dateFrom) filter.completedAt.$gte = new Date(dateFrom);
            if (dateTo) filter.completedAt.$lte = new Date(new Date(dateTo).setHours(23, 59, 59, 999));
        }

        const transactions = await DispatchTransaction.find(filter).sort({ completedAt: -1 });

        const csvRows = [
            'Dispatch ID,Date,Model,Boxes Dispatched,Parts Dispatched,Operator,Box Numbers,Notes'
        ];

        for (const tx of transactions) {
            const dateStr = tx.completedAt ? tx.completedAt.toISOString().slice(0, 19).replace('T', ' ') : '';
            const boxNumbers = tx.allocatedBoxes.map(b => b.batchNumber).join(';');
            const safeNotes = (tx.notes || '').replace(/,/g, ' ');
            csvRows.push(`${tx.dispatchId},${dateStr},${tx.modelId},${tx.allocatedBoxes.length},${tx.dispatchedPartCount},${tx.operatorUsername},"${boxNumbers}","${safeNotes}"`);
        }

        res.header('Content-Type', 'text/csv');
        res.attachment(`dispatch_report_${new Date().toISOString().slice(0, 10)}.csv`);
        res.send(csvRows.join('\r\n'));
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
