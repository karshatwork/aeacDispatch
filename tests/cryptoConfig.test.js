// tests/cryptoConfig.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
    encryptConfig,
    decryptConfig,
    saveEncryptedConfig,
    loadEncryptedConfig,
    updateConfigValue
} = require('../src/utils/cryptoConfig');

describe('Encrypted Configuration Engine (AES-256-GCM)', () => {
    const testSecret = 'TEST_CUSTOM_SECRET_PHRASE_12345';
    const sampleConfig = {
        PORT: 4000,
        MONGO_URI: 'mongodb://cluster0.internal:27017/plc_sticker',
        JWT_SECRET: 'super-secret-jwt-token',
        COM_PORT: 'COM4',
        COM_BAUD_RATE: 115200,
        FEATURES: {
            strictFifo: true,
            audioAlarms: true
        }
    };

    let tempDir;

    beforeAll(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-test-'));
    });

    afterAll(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('should encrypt and decrypt configuration object accurately', () => {
        const encryptedBuffer = encryptConfig(sampleConfig, testSecret);
        expect(Buffer.isBuffer(encryptedBuffer)).toBe(true);
        expect(encryptedBuffer.length).toBeGreaterThan(32); // IV + Tag + Data

        const decrypted = decryptConfig(encryptedBuffer, testSecret);
        expect(decrypted).toEqual(sampleConfig);
    });

    test('should fail decryption if wrong secret is supplied', () => {
        const encryptedBuffer = encryptConfig(sampleConfig, testSecret);
        expect(() => {
            decryptConfig(encryptedBuffer, 'WRONG_SECRET_KEY');
        }).toThrow();
    });

    test('should detect tampering of ciphertext or auth tag (integrity check)', () => {
        const encryptedBuffer = encryptConfig(sampleConfig, testSecret);
        // Flip one bit in the ciphertext area
        const tampered = Buffer.from(encryptedBuffer);
        tampered[tampered.length - 2] ^= 0xFF;

        expect(() => {
            decryptConfig(tampered, testSecret);
        }).toThrow();
    });

    test('should save encrypted config to disk and read back', () => {
        const encFilePath = path.join(tempDir, 'test_config.enc');
        saveEncryptedConfig(encFilePath, sampleConfig);

        expect(fs.existsSync(encFilePath)).toBe(true);
        // Ensure file contents are not plain text
        const rawContent = fs.readFileSync(encFilePath, 'utf8');
        expect(rawContent).not.toContain('mongodb://');
        expect(rawContent).not.toContain('super-secret-jwt-token');

        const loaded = loadEncryptedConfig(encFilePath);
        expect(loaded).toEqual(sampleConfig);
    });

    test('should update config value dynamically in encrypted store', () => {
        const encFilePath = path.join(tempDir, 'dynamic.enc');
        saveEncryptedConfig(encFilePath, { MONGO_URI: 'mongodb://localhost:27017' });

        const updated = updateConfigValue('MONGO_URI', 'mongodb://srv-prod:27017', tempDir);
        expect(updated.MONGO_URI).toBe('mongodb://srv-prod:27017');
        expect(process.env.MONGO_URI).toBe('mongodb://srv-prod:27017');
    });
});
