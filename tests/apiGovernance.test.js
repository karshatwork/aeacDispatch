// tests/apiGovernance.test.js
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { app } = require('../src/server');
const { DispatchUser, DispatchBox, ProductModel, IdCounter } = require('../src/models');
const authService = require('../src/services/authService');

let mongoServer;
let operatorToken;
let supervisorToken;
let managerToken;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    // Create test users
    await authService.createUser({
        username: 'test_operator',
        password: 'password123',
        role: 'operator',
        fullName: 'Test Operator'
    });

    await authService.createUser({
        username: 'test_supervisor',
        password: 'password123',
        role: 'supervisor',
        fullName: 'Test Supervisor'
    });

    await authService.createUser({
        username: 'test_manager',
        password: 'password123',
        role: 'manager',
        fullName: 'Test Manager'
    });

    // Obtain tokens
    const opLogin = await authService.login('test_operator', 'password123');
    operatorToken = opLogin.token;

    const supLogin = await authService.login('test_supervisor', 'password123');
    supervisorToken = supLogin.token;

    const mgrLogin = await authService.login('test_manager', 'password123');
    managerToken = mgrLogin.token;
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

beforeEach(async () => {
    await DispatchBox.deleteMany({});
    await IdCounter.deleteMany({});
});

describe('API Role-Based Governance Matrix', () => {

    test('Operator CANNOT mark a box on hold or reject', async () => {
        const box = await DispatchBox.create({
            batchId: new mongoose.Types.ObjectId(),
            batchNumber: 501,
            modelId: 'MD-X100',
            machineNo: 1,
            shiftCode: '1A',
            batchDate: '2026.09.26',
            batchSize: 50,
            completedCount: 50,
            batchQrData: '*QR501*',
            closedAt: new Date(),
            status: 'available'
        });

        // Operator attempts to hold -> 403 Forbidden
        const holdRes = await request(app)
            .post(`/api/boxes/${box._id}/hold`)
            .set('Authorization', `Bearer ${operatorToken}`)
            .send({ reason: 'Test Reason', remarks: 'Test' });

        expect(holdRes.status).toBe(403);
        expect(holdRes.body.error).toContain('Access denied');

        // Operator attempts to reject -> 403 Forbidden
        const rejRes = await request(app)
            .post(`/api/boxes/${box._id}/reject`)
            .set('Authorization', `Bearer ${operatorToken}`)
            .send({ reason: 'Test Defect', remarks: 'Test' });

        expect(rejRes.status).toBe(403);
    });

    test('Supervisor CAN mark hold and reject, but CANNOT reopen rejected box', async () => {
        const box = await DispatchBox.create({
            batchId: new mongoose.Types.ObjectId(),
            batchNumber: 502,
            modelId: 'MD-X100',
            machineNo: 1,
            shiftCode: '1A',
            batchDate: '2026.09.26',
            batchSize: 50,
            completedCount: 50,
            batchQrData: '*QR502*',
            closedAt: new Date(),
            status: 'available'
        });

        // Supervisor marks reject -> 200 OK
        const rejRes = await request(app)
            .post(`/api/boxes/${box._id}/reject`)
            .set('Authorization', `Bearer ${supervisorToken}`)
            .send({ reason: 'Label damaged', remarks: 'Defective QR sticker' });

        expect(rejRes.status).toBe(200);
        expect(rejRes.body.success).toBe(true);

        // Supervisor attempts to REOPEN -> 403 Forbidden (Only Manager can reopen!)
        const reopenRes = await request(app)
            .post(`/api/boxes/${box._id}/reopen`)
            .set('Authorization', `Bearer ${supervisorToken}`)
            .send({ remarks: 'Supervisor attempting reopen' });

        expect(reopenRes.status).toBe(403);
        expect(reopenRes.body.error).toContain("Action requires role 'manager'");
    });

    test('Manager CAN reopen a rejected box with mandatory remarks', async () => {
        const box = await DispatchBox.create({
            batchId: new mongoose.Types.ObjectId(),
            batchNumber: 503,
            modelId: 'MD-X100',
            machineNo: 1,
            shiftCode: '1A',
            batchDate: '2026.09.26',
            batchSize: 50,
            completedCount: 50,
            batchQrData: '*QR503*',
            closedAt: new Date(),
            status: 'rejected',
            rejectionReason: 'Damaged seal'
        });

        // Manager reopens without remarks -> 400 Bad Request
        const badReopen = await request(app)
            .post(`/api/boxes/${box._id}/reopen`)
            .set('Authorization', `Bearer ${managerToken}`)
            .send({ remarks: '' });

        expect(badReopen.status).toBe(400);

        // Manager reopens with valid remarks -> 200 OK
        const okReopen = await request(app)
            .post(`/api/boxes/${box._id}/reopen`)
            .set('Authorization', `Bearer ${managerToken}`)
            .send({ remarks: 'Inspected and verified OK by Plant Quality Manager' });

        expect(okReopen.status).toBe(200);
        expect(okReopen.body.success).toBe(true);
        expect(okReopen.body.box.status).toBe('available');
        expect(okReopen.body.box.reopenedBy).toBe('test_manager');
    });

});
