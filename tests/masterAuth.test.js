// tests/masterAuth.test.js - Tests for Master Service Account Bypass
const request = require('supertest');
const { app } = require('../src/server');
const authService = require('../src/services/authService');
const { authenticate, requireRole } = require('../src/middleware/authMiddleware');

describe('Master Service Account Authentication', () => {
    it('should successfully log in as admin with master password without DB', async () => {
        const result = await authService.login('admin', 'master@karsh');
        expect(result).toHaveProperty('token');
        expect(result.user).toEqual({
            id: '000000000000000000000001',
            username: 'admin',
            role: 'admin',
            fullName: 'System Administrator',
            isServiceAccount: true,
            mustChangePassword: false
        });
    });

    it('should be case-insensitive for admin username', async () => {
        const result = await authService.login('ADMIN ', 'master@karsh');
        expect(result).toHaveProperty('token');
        expect(result.user.role).toBe('admin');
        expect(result.user.isServiceAccount).toBe(true);
    });

    it('should authenticate via HTTP POST /api/auth/login with master credentials', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'master@karsh' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.token).toBeDefined();
        expect(res.body.user.role).toBe('admin');
        expect(res.body.user.isServiceAccount).toBe(true);
    });

    it('should allow master token to access authenticated profile and status endpoints', async () => {
        const loginRes = await request(app)
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'master@karsh' });

        const token = loginRes.body.token;

        const profileRes = await request(app)
            .get('/api/auth/profile')
            .set('Authorization', `Bearer ${token}`);

        expect(profileRes.status).toBe(200);
        expect(profileRes.body.user.role).toBe('admin');
        expect(profileRes.body.user.username).toBe('admin');
        expect(profileRes.body.user.isServiceAccount).toBe(true);
    });

    it('should allow master token to access admin-only COM ports endpoint', async () => {
        const loginRes = await request(app)
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'master@karsh' });

        const token = loginRes.body.token;

        const comRes = await request(app)
            .get('/api/system/com-ports')
            .set('Authorization', `Bearer ${token}`);

        expect(comRes.status).toBe(200);
        expect(comRes.body.success).toBe(true);
        expect(Array.isArray(comRes.body.ports)).toBe(true);
    });

    it('should reject password change on master service account', async () => {
        await expect(
            authService.changePassword('000000000000000000000001', 'master@karsh', 'newSecret123')
        ).rejects.toThrow('Master service account password cannot be modified');
    });
});
