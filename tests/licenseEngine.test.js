// tests/licenseEngine.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
    getMachineFingerprint,
    generateLicenseKey,
    validateLicense,
    activateLicense,
    VENDOR_SECRET
} = require('../src/utils/licenseEngine');

describe('Cryptographic Hardware Licensing Engine', () => {
    let tempDir;

    beforeAll(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'license-test-'));
    });

    afterAll(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('should generate a valid machine code format RKFG-XXXX-YYYY-ZZZZ-WWWW', () => {
        const machineCode = getMachineFingerprint();
        expect(machineCode).toMatch(/^RKFG-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
    });


    test('should generate and successfully validate a license for the current machine', () => {
        const machineCode = getMachineFingerprint();
        const licenseBase64 = generateLicenseKey({
            machineCode,
            customerName: 'Mahindra Plant 2',
            expiresAt: '2029-12-31',
            features: ['FIFO_DISPATCH', 'REPORTS', 'CSV_EXPORT']
        });

        expect(typeof licenseBase64).toBe('string');
        const verification = validateLicense(licenseBase64);

        expect(verification.valid).toBe(true);
        expect(verification.payload.customerName).toBe('Mahindra Plant 2');
        expect(verification.payload.machineCode).toBe(machineCode);
        expect(verification.payload.features).toContain('FIFO_DISPATCH');
    });

    test('should reject license generated for a different machine (Hardware Lock)', () => {
        const foreignMachineCode = 'AEAC-DEAD-BEEF-0000-1111';
        const licenseBase64 = generateLicenseKey({
            machineCode: foreignMachineCode,
            customerName: 'Different Plant',
            expiresAt: '2029-12-31'
        });

        const verification = validateLicense(licenseBase64);
        expect(verification.valid).toBe(false);
        expect(verification.error).toContain('Hardware Lock Mismatch');
    });

    test('should reject expired license', () => {
        const machineCode = getMachineFingerprint();
        const expiredLicense = generateLicenseKey({
            machineCode,
            customerName: 'Expired Customer',
            expiresAt: '2020-01-01'
        });

        const verification = validateLicense(expiredLicense);
        expect(verification.valid).toBe(false);
        expect(verification.error).toContain('License has expired');
    });

    test('should reject tampered license (signature verification)', () => {
        const machineCode = getMachineFingerprint();
        const validLicenseBase64 = generateLicenseKey({
            machineCode,
            customerName: 'Original Customer',
            expiresAt: '2029-12-31'
        });

        // Decode and alter payload without re-signing
        const rawJson = JSON.parse(Buffer.from(validLicenseBase64, 'base64').toString('utf8'));
        rawJson.payload.customerName = 'Hacked Customer';
        const tamperedBase64 = Buffer.from(JSON.stringify(rawJson)).toString('base64');

        const verification = validateLicense(tamperedBase64);
        expect(verification.valid).toBe(false);
        expect(verification.error).toContain('Tampered license file');
    });

    test('should activate and persist license.key to target directory', () => {
        const machineCode = getMachineFingerprint();
        const licenseKeyStr = generateLicenseKey({
            machineCode,
            customerName: 'Mahindra Automotive Nashik',
            expiresAt: '2030-01-01'
        });

        const activation = activateLicense(licenseKeyStr, tempDir);
        expect(activation.valid).toBe(true);

        const keyFile = path.join(tempDir, 'license.key');
        expect(fs.existsSync(keyFile)).toBe(true);
        expect(fs.readFileSync(keyFile, 'utf8').trim()).toBe(licenseKeyStr.trim());
    });
});
