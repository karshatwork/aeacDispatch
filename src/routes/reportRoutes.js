// src/routes/reportRoutes.js
const express = require('express');
const router = express.Router();
const { DispatchTransaction, DispatchBox, DispatchUser } = require('../models');
const { authenticate, requireRole } = require('../middleware/authMiddleware');

// GET /api/reports/monthly - Summary metrics & chart data (supports optional dateFrom/dateTo/modelId filters)
router.get('/monthly', authenticate, requireRole('supervisor'), async (req, res) => {
    try {
        const { dateFrom, dateTo, modelId } = req.query;
        const now = new Date();

        // Resolve date range: use query params if provided, otherwise default to current calendar month
        let rangeStart, rangeEnd, rangeLabel;
        if (dateFrom || dateTo) {
            rangeStart = dateFrom ? new Date(dateFrom) : new Date(now.getFullYear(), now.getMonth(), 1);
            rangeEnd = dateTo ? new Date(new Date(dateTo).setHours(23, 59, 59, 999)) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
            // Build a human-readable label for the range
            const fmtDate = (d) => d.toLocaleDateString('default', { day: '2-digit', month: 'short', year: 'numeric' });
            rangeLabel = `${fmtDate(rangeStart)} – ${fmtDate(rangeEnd)}`;
        } else {
            rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
            rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
            rangeLabel = now.toLocaleString('default', { month: 'long', year: 'numeric' });
        }

        // Build dispatch transaction filter
        const txFilter = {
            status: 'completed',
            completedAt: { $gte: rangeStart, $lte: rangeEnd }
        };
        if (modelId && modelId !== 'ALL') txFilter.modelId = modelId;

        const filteredTxs = await DispatchTransaction.find(txFilter);

        let dispatchedBoxes = 0;
        let dispatchedParts = 0;
        const dailyBoxMap = {};
        const dailyPartsMap = {};
        const modelBoxMap = {};
        const modelPartsMap = {};

        for (const tx of filteredTxs) {
            dispatchedBoxes += tx.allocatedBoxes.length;
            dispatchedParts += tx.dispatchedPartCount;
            const dayKey = tx.completedAt.toISOString().slice(0, 10);
            dailyBoxMap[dayKey] = (dailyBoxMap[dayKey] || 0) + tx.allocatedBoxes.length;
            dailyPartsMap[dayKey] = (dailyPartsMap[dayKey] || 0) + tx.dispatchedPartCount;
            modelBoxMap[tx.modelId] = (modelBoxMap[tx.modelId] || 0) + tx.allocatedBoxes.length;
            modelPartsMap[tx.modelId] = (modelPartsMap[tx.modelId] || 0) + tx.dispatchedPartCount;
        }

        // Boxes rejected in range
        const rejFilter = { status: 'rejected', rejectedAt: { $gte: rangeStart, $lte: rangeEnd } };
        if (modelId && modelId !== 'ALL') rejFilter.modelId = modelId;
        const rejectedBoxes = await DispatchBox.countDocuments(rejFilter);

        // Active boxes currently on hold (not date-filtered – always live count)
        const activeHoldBoxes = await DispatchBox.countDocuments({ status: 'hold' });

        // Build volume time series chart:
        // If range > 35 days, aggregate by month into a monthly bar series.
        // If range <= 35 days, show granular daily line series spanning all days.
        const msPerDay = 24 * 60 * 60 * 1000;
        const totalDays = Math.round((rangeEnd - rangeStart) / msPerDay) + 1;
        const isMonthly = totalDays > 35;

        const volumeLabels = [];
        const volumeDataBoxes = [];
        const volumeDataParts = [];

        if (isMonthly) {
            const monthlyBoxMap = {};
            const monthlyPartsMap = {};
            for (const tx of filteredTxs) {
                if (tx.completedAt) {
                    const mKey = tx.completedAt.toISOString().slice(0, 7); // 'YYYY-MM'
                    monthlyBoxMap[mKey] = (monthlyBoxMap[mKey] || 0) + (tx.allocatedBoxes ? tx.allocatedBoxes.length : 0);
                    monthlyPartsMap[mKey] = (monthlyPartsMap[mKey] || 0) + (tx.dispatchedPartCount || 0);
                }
            }

            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const curDate = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
            const stopDate = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1);

            while (curDate <= stopDate) {
                const yyyy = curDate.getFullYear();
                const mm = String(curDate.getMonth() + 1).padStart(2, '0');
                const mKey = `${yyyy}-${mm}`;
                volumeLabels.push(`${monthNames[curDate.getMonth()]} ${yyyy}`);
                volumeDataBoxes.push(monthlyBoxMap[mKey] || 0);
                volumeDataParts.push(monthlyPartsMap[mKey] || 0);
                curDate.setMonth(curDate.getMonth() + 1);
            }
        } else {
            for (let i = 0; i < totalDays; i++) {
                const d = new Date(rangeStart.getTime() + i * msPerDay);
                const dayStr = d.toISOString().slice(0, 10);
                volumeLabels.push(`${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`);
                volumeDataBoxes.push(dailyBoxMap[dayStr] || 0);
                volumeDataParts.push(dailyPartsMap[dayStr] || 0);
            }
        }

        const modelLabels = Object.keys(modelBoxMap);
        const modelDataBoxes = Object.values(modelBoxMap);
        const modelDataParts = modelLabels.map(k => modelPartsMap[k] || 0);

        // Cancelled & Stale (failed/abandoned) transactions in range
        const cancelledTxs = await DispatchTransaction.countDocuments({
            status: 'cancelled',
            $or: [{ cancelledAt: { $gte: rangeStart, $lte: rangeEnd } }, { startedAt: { $gte: rangeStart, $lte: rangeEnd } }]
        });
        const staleTxs = await DispatchTransaction.countDocuments({
            status: 'stale',
            $or: [{ cancelledAt: { $gte: rangeStart, $lte: rangeEnd } }, { startedAt: { $gte: rangeStart, $lte: rangeEnd } }]
        });

        res.json({
            success: true,
            metrics: {
                dispatchedThisMonthBoxes: dispatchedBoxes,
                dispatchedThisMonthParts: dispatchedParts,
                activeHoldBoxes,
                rejectedThisMonthBoxes: rejectedBoxes,
                dispatchedThisMonthTxs: filteredTxs.length,
                cancelledThisMonthTxs: cancelledTxs,
                staleThisMonthTxs: staleTxs,
                monthName: rangeLabel
            },
            charts: {
                daily: { 
                    labels: volumeLabels, 
                    dataBoxes: volumeDataBoxes, 
                    dataParts: volumeDataParts,
                    isMonthly,
                    granularity: isMonthly ? 'monthly' : 'daily'
                },
                models: { labels: modelLabels, dataBoxes: modelDataBoxes, dataParts: modelDataParts }
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/reports/history - Historical transactions (includes completed, cancelled, and stale/failed dispatches)
router.get('/history', authenticate, requireRole('supervisor'), async (req, res) => {
    try {
        const { dateFrom, dateTo, modelId, status = 'ALL', page = 1, limit = 20 } = req.query;
        const filter = {};

        if (status && status !== 'ALL') {
            filter.status = status;
        } else {
            filter.status = { $in: ['completed', 'cancelled', 'stale'] };
        }

        if (modelId && modelId !== 'ALL') filter.modelId = modelId;
        if (dateFrom || dateTo) {
            const start = dateFrom ? new Date(dateFrom) : new Date(0);
            const end = dateTo ? new Date(new Date(dateTo).setHours(23, 59, 59, 999)) : new Date();
            filter.$or = [
                { completedAt: { $gte: start, $lte: end } },
                { cancelledAt: { $gte: start, $lte: end } },
                { startedAt: { $gte: start, $lte: end } }
            ];
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const [transactions, total] = await Promise.all([
            DispatchTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit, 10)),
            DispatchTransaction.countDocuments(filter)
        ]);

        // Resolve operator full names for records that don't have it stored
        const unresolvedUsernames = [...new Set(
            transactions.filter(tx => !tx.operatorFullName && tx.operatorUsername).map(tx => tx.operatorUsername)
        )];
        const userMap = {};
        if (unresolvedUsernames.length > 0) {
            const users = await DispatchUser.find({ username: { $in: unresolvedUsernames } }).select('username fullName').lean();
            users.forEach(u => { if (u.username) userMap[u.username] = u.fullName; });
        }
        const txsWithFullName = transactions.map(tx => ({
            ...tx.toObject(),
            operatorFullName: tx.operatorFullName || userMap[tx.operatorUsername] || tx.operatorUsername
        }));

        res.json({
            success: true,
            transactions: txsWithFullName,
            total,
            page: parseInt(page, 10),
            pages: Math.ceil(total / parseInt(limit, 10))
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/reports/export-csv - Downloadable CSV report (includes completed, cancelled, and stale/failed dispatches)
router.get('/export-csv', authenticate, requireRole('supervisor'), async (req, res) => {
    try {
        const { dateFrom, dateTo, status = 'ALL', modelId } = req.query;
        const filter = {};

        if (status && status !== 'ALL') {
            filter.status = status;
        } else {
            filter.status = { $in: ['completed', 'cancelled', 'stale'] };
        }

        if (modelId && modelId !== 'ALL') filter.modelId = modelId;

        if (dateFrom || dateTo) {
            const start = dateFrom ? new Date(dateFrom) : new Date(0);
            const end = dateTo ? new Date(new Date(dateTo).setHours(23, 59, 59, 999)) : new Date();
            filter.$or = [
                { completedAt: { $gte: start, $lte: end } },
                { cancelledAt: { $gte: start, $lte: end } },
                { startedAt: { $gte: start, $lte: end } }
            ];
        }

        const transactions = await DispatchTransaction.find(filter).sort({ createdAt: -1 });

        // Resolve full names for records without stored operatorFullName
        const unresolvedUsernames = [...new Set(
            transactions.filter(tx => !tx.operatorFullName && tx.operatorUsername).map(tx => tx.operatorUsername)
        )];
        const userMap = {};
        if (unresolvedUsernames.length > 0) {
            const users = await DispatchUser.find({ username: { $in: unresolvedUsernames } }).select('username fullName').lean();
            users.forEach(u => { if (u.username) userMap[u.username] = u.fullName; });
        }
        const resolveFullName = (tx) => tx.operatorFullName || userMap[tx.operatorUsername] || tx.operatorUsername;

        const csvRows = [
            'Dispatch ID,Date,Status,Model,Target Type,Target Quantity,Boxes Allocated,Boxes Scanned,Parts Dispatched,Operator,Cancellation / Stale Reason,Box Numbers,Notes'
        ];

        for (const tx of transactions) {
            const dateObj = tx.completedAt || tx.cancelledAt || tx.startedAt || tx.createdAt;
            const dateStr = dateObj ? dateObj.toISOString().slice(0, 19).replace('T', ' ') : '';
            const boxNumbers = (tx.allocatedBoxes || []).map(b => b.batchNumber).join(';');
            const safeReason = (tx.cancellationReason || '').replace(/"/g, '""');
            const safeNotes = (tx.notes || '').replace(/"/g, '""');
            const statusUpper = (tx.status || 'unknown').toUpperCase();
            const scannedCount = (tx.scannedBoxes || []).length;
            const allocatedCount = (tx.allocatedBoxes || []).length;

            csvRows.push(`"${tx.dispatchId}","${dateStr}","${statusUpper}","${tx.modelId}","${tx.targetType || 'boxes'}",${tx.targetQuantity || 0},${allocatedCount},${scannedCount},${tx.dispatchedPartCount || 0},"${resolveFullName(tx)}","${safeReason}","${boxNumbers}","${safeNotes}"`);
        }

        res.header('Content-Type', 'text/csv');
        res.attachment(`dispatch_report_${new Date().toISOString().slice(0, 10)}.csv`);
        res.send(csvRows.join('\r\n'));
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

