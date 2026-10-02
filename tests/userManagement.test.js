// tests/userManagement.test.js - Tests for User Management & Governance
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { app } = require('../src/server');
const { DispatchUser } = require('../src/models');
const authService = require('../src/services/authService');

let mongoServer;
let adminToken;
let managerToken;
let operatorToken;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    await authService.createUser({
        username: 'test_admin',
        password: 'password123',
        role: 'admin',
        fullName: 'Test Administrator'
    });

    await authService.createUser({
        username: 'test_manager',
        password: 'password123',
        role: 'manager',
        fullName: 'Test Manager'
    });

    await authService.createUser({
        username: 'test_operator',
        password: 'password123',
        role: 'operator',
        fullName: 'Test Operator'
    });

    const adm = await authService.login('test_admin', 'password123');
    adminToken = adm.token;

    const mgr = await authService.login('test_manager', 'password123');
    managerToken = mgr.token;

    const op = await authService.login('test_operator', 'password123');
    operatorToken = op.token;
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

describe('User Management Access Control & Features', () => {
    it('should deny non-admin roles (operator, manager) access to GET /api/system/users', async () => {
        const opRes = await request(app)
            .get('/api/system/users')
            .set('Authorization', `Bearer ${operatorToken}`);
        expect(opRes.status).toBe(403);

        const mgrRes = await request(app)
            .get('/api/system/users')
            .set('Authorization', `Bearer ${managerToken}`);
        expect(mgrRes.status).toBe(403);
    });

    it('should deny non-admin roles creating users', async () => {
        const res = await request(app)
            .post('/api/system/users')
            .set('Authorization', `Bearer ${managerToken}`)
            .send({
                username: 'new_op',
                fullName: 'New Op',
                password: 'password123',
                role: 'operator'
            });
        expect(res.status).toBe(403);
    });

    it('should allow admin to list, create, edit, toggle, and delete users', async () => {
        // 1. Create user
        const createRes = await request(app)
            .post('/api/system/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                username: 'station18_op',
                fullName: 'Station 18 Operator',
                password: 'password123',
                role: 'operator'
            });
        expect(createRes.status).toBe(200);
        expect(createRes.body.success).toBe(true);
        const createdId = createRes.body.user.id;

        // 2. Edit user
        const editRes = await request(app)
            .put(`/api/system/users/${createdId}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                fullName: 'Station 18 Senior Operator',
                role: 'supervisor'
            });
        expect(editRes.status).toBe(200);
        expect(editRes.body.user.fullName).toBe('Station 18 Senior Operator');
        expect(editRes.body.user.role).toBe('supervisor');

        // 3. Toggle active
        const toggleRes = await request(app)
            .patch(`/api/system/users/${createdId}/toggle-active`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(toggleRes.status).toBe(200);
        expect(toggleRes.body.active).toBe(false);

        // 4. Reset password (minimum requirement check)
        const badPwdRes = await request(app)
            .post(`/api/system/users/${createdId}/reset-password`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ newPassword: '123' });
        expect(badPwdRes.status).toBe(400);
        expect(badPwdRes.body.error).toContain('at least 6 characters');

        const okPwdRes = await request(app)
            .post(`/api/system/users/${createdId}/reset-password`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ newPassword: 'newsecurepass123' });
        expect(okPwdRes.status).toBe(200);

        // 5. Delete user
        const delRes = await request(app)
            .delete(`/api/system/users/${createdId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(delRes.status).toBe(200);
        expect(delRes.body.success).toBe(true);
    });

    it('should prevent admin from deactivating or demoting their own active account', async () => {
        const self = await DispatchUser.findOne({ username: 'test_admin' });
        const res = await request(app)
            .patch(`/api/system/users/${self._id}/toggle-active`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Cannot deactivate your own active Administrator account');
    });
});
