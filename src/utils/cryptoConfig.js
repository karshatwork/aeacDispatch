// src/utils/cryptoConfig.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Default hardware-bound derivation key for AEAC Dispatch
const MASTER_SALT = 'AEAC_DISPATCH_FIRMWARE_SALT_v1_2026';
const DEFAULT_KEY_PHRASE = 'ELEKTROSIL_SECURE_ENCRYPTED_CONFIG_KEY_7749';

/**
 * Derive 256-bit encryption key using PBKDF2
 */
function deriveKey(secret = DEFAULT_KEY_PHRASE) {
    return crypto.pbkdf2Sync(secret, MASTER_SALT, 100000, 32, 'sha256');
}

/**
 * Encrypt a config object into an AES-256-GCM payload buffer
 */
function encryptConfig(configObj, secret = DEFAULT_KEY_PHRASE) {
    const key = deriveKey(secret);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const jsonText = JSON.stringify(configObj, null, 2);
    const encrypted = Buffer.concat([cipher.update(jsonText, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Packed format: [16 bytes IV][16 bytes AuthTag][Ciphertext]
    return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt an AES-256-GCM buffer into the original config object
 */
function decryptConfig(buffer, secret = DEFAULT_KEY_PHRASE) {
    if (!Buffer.isBuffer(buffer)) {
        buffer = Buffer.from(buffer, 'base64');
    }

    if (buffer.length < 32) {
        throw new Error('Invalid encrypted config payload: too short');
    }

    const iv = buffer.subarray(0, 16);
    const authTag = buffer.subarray(16, 32);
    const ciphertext = buffer.subarray(32);

    const key = deriveKey(secret);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
}

/**
 * Save config object to an encrypted file (config.enc)
 */
function saveEncryptedConfig(filePath, configObj) {
    const encrypted = encryptConfig(configObj);
    fs.writeFileSync(filePath, encrypted);
}

/**
 * Load and decrypt config file (config.enc)
 */
function loadEncryptedConfig(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const rawBuffer = fs.readFileSync(filePath);
    return decryptConfig(rawBuffer);
}

function findConfigFile(fileName, customDir) {
    if (customDir) {
        const fullPath = path.join(customDir, fileName);
        return fs.existsSync(fullPath) ? fullPath : null;
    }

    const candidateDirs = [
        process.resourcesPath ? path.dirname(process.resourcesPath) : null,
        process.cwd(),
        __dirname,
        path.resolve(__dirname, '..'),
        path.resolve(__dirname, '../..')
    ].filter(Boolean);

    for (const dir of candidateDirs) {
        const fullPath = path.join(dir, fileName);
        if (fs.existsSync(fullPath)) return fullPath;
    }
    return null;
}

/**
 * Initialize environment variables from config.enc (or fallback to .env)
 */
function initEnvironment(customDir) {
    const encPath = findConfigFile('config.enc', customDir);
    const envPath = findConfigFile('.env', customDir);

    if (encPath) {
        try {
            const config = loadEncryptedConfig(encPath);
            for (const [key, value] of Object.entries(config)) {
                process.env[key] = String(value);
            }
            console.log(`[CONFIG] Successfully loaded encrypted configuration (${encPath})`);
            return config;
        } catch (err) {
            console.error('[CONFIG ERROR] Failed to decrypt config.enc:', err.message);
        }
    }

    // Fallback: if .env exists, load it
    if (envPath) {
        require('dotenv').config({ path: envPath });
        console.log(`[CONFIG] Loaded plain-text .env configuration (${envPath})`);
    }

    return null;
}

/**
 * Update a specific key in config.enc (or create config.enc if not exists)
 */
function updateConfigValue(key, value, targetDir = process.cwd()) {
    let encPath = findConfigFile('config.enc', targetDir);
    if (!encPath) {
        encPath = path.join(targetDir, 'config.enc');
    }

    let existing = {};
    if (fs.existsSync(encPath)) {
        try {
            existing = loadEncryptedConfig(encPath) || {};
        } catch (e) {
            existing = {};
        }
    }

    existing[key] = value;
    saveEncryptedConfig(encPath, existing);
    process.env[key] = String(value);
    return existing;
}

module.exports = {
    encryptConfig,
    decryptConfig,
    saveEncryptedConfig,
    loadEncryptedConfig,
    initEnvironment,
    updateConfigValue,
    findConfigFile
};
