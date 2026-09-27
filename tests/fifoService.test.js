// tests/fifoService.test.js
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { DispatchBox, DispatchTransaction, BoxLifecycleEvent, IdCounter } = require('../src/models');
const {
    planDispatch,
    verifyScan,
    confirmDispatch,
    cancelDispatch,
    recoverStaleTransactions
} = require('../src/services/fifoService');

let mongoServer;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

beforeEach(async () => {
    await DispatchBox.deleteMany({});
    await DispatchTransaction.deleteMany({});
    await BoxLifecycleEvent.deleteMany({});
    await IdCounter.deleteMany({});
});

describe('Strict FIFO Dispatch Engine', () => {

    test('allocates oldest available boxes strictly by closedAt ASC', async () => {
        // Create 3 available boxes with staggered closedAt dates
        const box1 = await DispatchBox.create({
            batchId: new mongoose.Types.ObjectId(),
            batchNumber: 101,
            modelId: 'MD-X100',
            machineNo: 1,
            shiftCode: '1A',
            batchDate: '2026.09.20',
            batchSize: 100,
            completedCount: 100,
            serialNumbers: ['SN101-1', 'SN101-2'],
            batchQrData: '*SUP01|MD-X100|1A(101)*',
            closedAt: new Date('2026-09-20T10:00:00Z'),
            status: 'available'
        });

        const box2 = await DispatchBox.create({
            batchId: new mongoose.Types.ObjectId(),
            batchNumber: 102,
            modelId: 'MD-X100',
            machineNo: 1,
            shiftCode: '1B',
            batchDate: '2026.09.21',
            batchSize: 100,
            completedCount: 100,
            serialNumbers: ['SN102-1', 'SN102-2'],
            batchQrData: '*SUP01|MD-X100|1B(102)*',
            closedAt: new Date('2026-09-21T10:00:00Z'),
            status: 'available'
        });

        const box3 = await DispatchBox.create({
            batchId: new mongoose.Types.ObjectId(),
            batchNumber: 103,
            modelId: 'MD-X100',
            machineNo: 1,
            shiftCode: '1A',
            batchDate: '2026.09.22',
            batchSize: 100,
            completedCount: 100,
            serialNumbers: ['SN103-1', 'SN103-2'],
            batchQrData: '*SUP01|MD-X100|1A(103)*',
            closedAt: new Date('2026-09-22T10:00:00Z'),
            status: 'available'
        });

        // Request 2 boxes: should strictly allocate box1 (Sep 20) and box2 (Sep 21)
        const result = await planDispatch({
            modelId: 'MD-X100',
            targetType: 'boxes',
            targetQuantity: 2,
            operatorUsername: 'operator1'
        });

        expect(result.transaction.allocatedBoxes).toHaveLength(2);
        expect(result.transaction.allocatedBoxes[0].batchNumber).toBe(101);
        expect(result.transaction.allocatedBoxes[1].batchNumber).toBe(102);
        expect(result.transaction.status).toBe('in_progress');
    });

    test('skips held and rejected boxes during FIFO allocation', async () => {
        // Box 1 is OLDER but ON HOLD
        await DispatchBox.create({
            batchId: new mongoose.Types.ObjectId(),
            batchNumber: 201,
            modelId: 'MD-X200',
            machineNo: 1,
            shiftCode: '1A',
            batchDate: '2026.09.20',
            batchSize: 50,
            completedCount: 50,
            batchQrData: '*SUP01|MD-X200|1A(201)*',
            closedAt: new Date('2026-09-20T10:00:00Z'),
            status: 'hold',
            holdReason: 'Quality inspection pending'
        });

        // Box 2 is AVAILABLE
        const box2 = await DispatchBox.create({
            batchId: new mongoose.Types.ObjectId(),
            batchNumber: 202,
            modelId: 'MD-X200',
            machineNo: 1,
            shiftCode: '1A',
            batchDate: '2026.09.21',
            batchSize: 50,
            completedCount: 50,
            batchQrData: '*SUP01|MD-X200|1A(202)*',
            closedAt: new Date('2026-09-21T10:00:00Z'),
            status: 'available'
        });

        const result = await planDispatch({
            modelId: 'MD-X200',
            targetType: 'boxes',
            targetQuantity: 1,
            operatorUsername: 'operator1'
        });

        // Box 201 was skipped because it is on hold
        expect(result.transaction.allocatedBoxes).toHaveLength(1);
        expect(result.transaction.allocatedBoxes[0].batchNumber).toBe(202);
    });

    test('supports allocation by part count (completedCount)', async () => {
        await DispatchBox.create({
            batchId: new mongoose.Types.ObjectId(),
            batchNumber: 301,
            modelId: 'MD-X300',
            machineNo: 1,
            shiftCode: '1A',
            batchDate: '2026.09.20',
            batchSize: 50,
            completedCount: 50,
            batchQrData: '*SUP01|MD-X300|1A(301)*',
            closedAt: new Date('2026-09-20T10:00:00Z'),
            status: 'available'
        });

        await DispatchBox.create({
            batchId: new mongoose.Types.ObjectId(),
            batchNumber: 302,
            modelId: 'MD-X300',
            machineNo: 1,
            shiftCode: '1A',
            batchDate: '2026.09.21',
            batchSize: 100,
            completedCount: 100,
            batchQrData: '*SUP01|MD-X300|1A(302)*',
            closedAt: new Date('2026-09-21T10:00:00Z'),
            status: 'available'
        });

        // Request 120 parts: should allocate 301 (50) + 302 (100) = 150 parts
        const result = await planDispatch({
            modelId: 'MD-X300',
            targetType: 'parts',
            targetQuantity: 120,
            operatorUsername: 'operator1'
        });

        expect(result.transaction.allocatedBoxes).toHaveLength(2);
        expect(result.transaction.dispatchedPartCount).toBe(150);
    });

    test('enforces scan verification: allows any order within allocated set, hard blocks non-FIFO or invalid', async () => {
        const box1 = await DispatchBox.create({
            batchId: new mongoose.Types.ObjectId(),
            batchNumber: 401,
            modelId: 'MD-X400',
            machineNo: 1,
            shiftCode: '1A',
            batchDate: '2026.09.20',
            batchSize: 50,
            completedCount: 50,
            batchQrData: '*QR401*',
            closedAt: new Date('2026-09-20T10:00:00Z'),
            status: 'available'
        });

        const box2 = await DispatchBox.create({
            batchId: new mongoose.Types.ObjectId(),
            batchNumber: 402,
            modelId: 'MD-X400',
            machineNo: 1,
            shiftCode: '1A',
            batchDate: '2026.09.21',
            batchSize: 50,
            completedCount: 50,
            batchQrData: '*QR402*',
            closedAt: new Date('2026-09-21T10:00:00Z'),
            status: 'available'
        });

        // Box 3 is newer and NOT allocated
        const box3 = await DispatchBox.create({
            batchId: new mongoose.Types.ObjectId(),
            batchNumber: 403,
            modelId: 'MD-X400',
            machineNo: 1,
            shiftCode: '1A',
            batchDate: '2026.09.22',
            batchSize: 50,
            completedCount: 50,
            batchQrData: '*QR403*',
            closedAt: new Date('2026-09-22T10:00:00Z'),
            status: 'available'
        });

        const { transaction } = await planDispatch({
            modelId: 'MD-X400',
            targetType: 'boxes',
            targetQuantity: 2,
            operatorUsername: 'operator1'
        });

        // Scan Box 2 first (reverse order among allocated set) -> should PASS
        const scan2 = await verifyScan({
            dispatchId: transaction.dispatchId,
            scannedPayload: '*QR402*',
            operatorUsername: 'operator1'
        });
        expect(scan2.success).toBe(true);
        expect(scan2.code).toBe('SCAN_VERIFIED');
        expect(scan2.progress.scanned).toBe(1);

        // Attempt to scan Box 3 (newer, unallocated available box) -> should FAIL with FIFO_VIOLATION
        const scan3 = await verifyScan({
            dispatchId: transaction.dispatchId,
            scannedPayload: '*QR403*',
            operatorUsername: 'operator1'
        });
        expect(scan3.success).toBe(false);
        expect(scan3.code).toBe('FIFO_VIOLATION');

        // Scan Box 1 -> should PASS
        const scan1 = await verifyScan({
            dispatchId: transaction.dispatchId,
            scannedPayload: '*QR401*',
            operatorUsername: 'operator1'
        });
        expect(scan1.success).toBe(true);
        expect(scan1.progress.isReady).toBe(true);

        // Confirm dispatch
        const confirmed = await confirmDispatch({
            dispatchId: transaction.dispatchId,
            operatorUsername: 'operator1',
            notes: 'Test dispatch note'
        });

        expect(confirmed.success).toBe(true);
        expect(confirmed.transaction.status).toBe('completed');

        // Check box records updated to 'dispatched'
        const updatedBox1 = await DispatchBox.findById(box1._id);
        const updatedBox2 = await DispatchBox.findById(box2._id);
        expect(updatedBox1.status).toBe('dispatched');
        expect(updatedBox2.status).toBe('dispatched');
        expect(updatedBox1.dispatchId).toBe(transaction.dispatchId);
    });

    test('recovers stale transactions on startup', async () => {
        // Create an in_progress transaction that was abandoned
        await DispatchTransaction.create({
            dispatchId: 'DSP202609200001',
            modelId: 'MD-X100',
            targetType: 'boxes',
            targetQuantity: 1,
            status: 'in_progress',
            allocatedBoxes: [],
            scannedBoxes: [],
            operatorUsername: 'old_op',
            startedAt: new Date('2026-09-20T10:00:00Z')
        });

        await recoverStaleTransactions();

        const recovered = await DispatchTransaction.findOne({ dispatchId: 'DSP202609200001' });
        expect(recovered.status).toBe('stale');
        expect(recovered.cancellationReason).toContain('Application closed or restarted');
    });

});
