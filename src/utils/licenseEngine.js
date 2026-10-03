// src/utils/licenseEngine.js - Industrial Asymmetric RSA Cryptographic Licensing Engine
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Embedded Vendor RSA-2048 Public Key (Used for signature verification on client machines)
// The corresponding Private Key is held strictly on the vendor machine (keys/vendor_private.pem)
const VENDOR_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtM40itw/38yEJ+jgM6Qc
dr7OnXB1GyV/7VNBkV/l8s6p1Vy0+1i+KokkE8Y0dg5vuxBQYnBZwysO+Lb8Akak
Ftaq2oi2gm0pWh/0YzHsXQ9BN+bh8AOmuRRMSfEIWtq7e0dxk4FMNnFapnnc3EX5
w7m5+LJ4Ec6v2HN15QY/idLc5Aukr4q7ODHSpGP/kCPOVRjw1LNvhaiGVG1TVAmp
NsBFTx6CFmfFTxwVGx1BlWfaaQ6niCe9IAIzYW2Ft8F9GpG8Nb6hoiqOdgJhyeqm
qvDjZSQFz9UeA0HI1FRo8tHz3ehI482FHZ1HFZMlJrXODkgHugENG0KAbpdNgOk3
XwIDAQAB
-----END PUBLIC KEY-----`;

// Cache machine fingerprint in memory once resolved
let cachedMachineCode = null;

/**
 * Determine root application directory across packaged Electron release and development
 */
function getAppRootDir() {
    if (process.resourcesPath && !process.resourcesPath.includes('node_modules')) {
        return path.dirname(process.resourcesPath);
    }
    return process.cwd();
}

/**
 * Retrieve unique hardware fingerprint on Windows
 * Queries: Motherboard Serial (CIM/WMI) + CPU Processor ID (CIM/WMI) + Registry MachineGuid + Network MAC
 * Formats as readable Machine Code: RKFG-XXXX-YYYY-ZZZZ-WWWW
 */
function getMachineFingerprint() {
    if (cachedMachineCode) return cachedMachineCode;

    let rawHardwareId = '';

    if (process.platform === 'win32') {
        // 1. Motherboard Serial (PowerShell CIM with WMIC fallback)
        try {
            const out = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_BaseBoard).SerialNumber"', { timeout: 3000 }).toString().trim();
            if (out) rawHardwareId += `BOARD:${out};`;
        } catch (_) {
            try {
                const out = execSync('wmic baseboard get serialnumber /format:list', { timeout: 2000 }).toString();
                rawHardwareId += `BOARD:${out.replace(/SerialNumber=/gi, '').trim()};`;
            } catch (_) {}
        }

        // 2. CPU Processor ID (PowerShell CIM with WMIC fallback)
        try {
            const out = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Processor).ProcessorId"', { timeout: 3000 }).toString().trim();
            if (out) rawHardwareId += `CPU:${out};`;
        } catch (_) {
            try {
                const out = execSync('wmic cpu get processorid /format:list', { timeout: 2000 }).toString();
                rawHardwareId += `CPU:${out.replace(/ProcessorId=/gi, '').trim()};`;
            } catch (_) {}
        }

        // 3. Windows Machine GUID from Registry
        try {
            const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { timeout: 2000 }).toString();
            const match = out.match(/MachineGuid\s+REG_SZ\s+([a-fA-F0-9-]+)/i);
            if (match) rawHardwareId += `GUID:${match[1]};`;
        } catch (_) {}
    }

    // 4. Primary Network MAC address
    const networkInterfaces = os.networkInterfaces();
    for (const name of Object.keys(networkInterfaces)) {
        for (const net of networkInterfaces[name]) {
            if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
                rawHardwareId += `MAC:${net.mac};`;
                break;
            }
        }
    }

    // Fallback if hardware queries returned blank
    if (!rawHardwareId) {
        rawHardwareId = os.hostname() + '-' + os.platform() + '-' + os.arch();
    }

    // SHA-256 hash formatted into 4 groups of 4 uppercase hex characters
    const hash = crypto.createHash('sha256').update(rawHardwareId).digest('hex').toUpperCase();
    cachedMachineCode = `RKFG-${hash.substring(0, 4)}-${hash.substring(4, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}`;
    return cachedMachineCode;
}

/**
 * Generate a cryptographically signed license key for a specific machine using RSA-2048 Private Key
 */
function generateLicenseKey({
    machineCode,
    customerName = 'Mahindra',
    expiresAt = '2028-12-31',
    features = ['FIFO_DISPATCH', 'REPORTS', 'TRACEABILITY', 'MANAGER_REOPEN', 'CSV_EXPORT'],
    privateKeyPem = null
}) {
    if (!machineCode || (!machineCode.startsWith('RKFG-') && !machineCode.startsWith('AEAC-'))) {
        throw new Error('Valid machine code in format RKFG-XXXX-YYYY-ZZZZ-WWWW is required');
    }

    // Load private key from parameter or keys directory
    let privateKey = privateKeyPem;
    if (!privateKey) {
        const keyCandidates = [
            path.join(getAppRootDir(), 'keys', 'vendor_private.pem'),
            path.join(__dirname, '../../keys/vendor_private.pem'),
            path.join(__dirname, '../keys/vendor_private.pem')
        ];
        const foundPath = keyCandidates.find(p => fs.existsSync(p));
        if (foundPath) {
            privateKey = fs.readFileSync(foundPath, 'utf8');
        }
    }

    if (!privateKey) {
        throw new Error('Vendor RSA Private Key not found! Cannot sign license without keys/vendor_private.pem');
    }

    const payload = {
        product: 'RK-FG-DISPATCH-MANAGEMENT-SYSTEM',
        machineCode: machineCode.toUpperCase().trim(),
        customerName,
        issuedAt: new Date().toISOString().slice(0, 10),
        expiresAt, // YYYY-MM-DD or 'PERPETUAL'
        features,
        version: '2.0.0'
    };

    const payloadJson = JSON.stringify(payload);

    // Cryptographic RSA-SHA256 signature
    const signer = crypto.createSign('SHA256');
    signer.update(payloadJson);
    signer.end();
    const signature = signer.sign(privateKey, 'base64');

    const licenseData = {
        payload,
        signature,
        algorithm: 'RSA-SHA256'
    };

    return Buffer.from(JSON.stringify(licenseData, null, 2)).toString('base64');
}

/**
 * Validate monotonic clock watermark to prevent system date rollback attacks
 */
function verifyClockIntegrity() {
    const watermarkPath = path.join(getAppRootDir(), '.clock_watermark');
    let lastSeen = 0;
    if (fs.existsSync(watermarkPath)) {
        try {
            const raw = fs.readFileSync(watermarkPath, 'utf8').trim();
            lastSeen = parseInt(raw, 10) || 0;
        } catch (_) {}
    }

    const now = Date.now();
    // Allow up to 3 minutes tolerance for normal NTP drift
    if (lastSeen > 0 && (now + 180000) < lastSeen) {
        const lastSeenDate = new Date(lastSeen).toISOString().slice(0, 19).replace('T', ' ');
        return {
            valid: false,
            error: `System Clock Rollback Detected! Current time is prior to last verified run (${lastSeenDate} UTC). Terminal locked.`
        };
    }

    // Advance watermark monotonically
    if (now > lastSeen) {
        try {
            fs.writeFileSync(watermarkPath, String(now), 'utf8');
        } catch (_) {}
    }

    return { valid: true };
}

/**
 * Validate license payload against current machine hardware and RSA public key
 */
function validateLicense(licenseBase64OrPath) {
    try {
        let licenseStr = '';
        if (fs.existsSync(licenseBase64OrPath)) {
            licenseStr = fs.readFileSync(licenseBase64OrPath, 'utf8').trim();
        } else {
            licenseStr = (licenseBase64OrPath || '').trim();
        }

        const currentMachineCode = getMachineFingerprint();

        if (!licenseStr) {
            return {
                valid: false,
                error: 'No license key installed on this system',
                machineCode: currentMachineCode,
                unlicensed: true
            };
        }

        // Decode Base64
        let licenseData;
        try {
            const decodedJson = Buffer.from(licenseStr, 'base64').toString('utf8');
            licenseData = JSON.parse(decodedJson);
        } catch (_) {
            return {
                valid: false,
                error: 'Corrupt or malformed license file format',
                machineCode: currentMachineCode
            };
        }

        if (!licenseData.payload || !licenseData.signature) {
            return {
                valid: false,
                error: 'Malformed license structure: missing payload or cryptographic signature',
                machineCode: currentMachineCode
            };
        }

        // 1. Verify Cryptographic Signature
        // Check for RSA-SHA256 signature
        let isSignatureValid = false;
        try {
            const verifier = crypto.createVerify('SHA256');
            verifier.update(JSON.stringify(licenseData.payload));
            verifier.end();
            isSignatureValid = verifier.verify(VENDOR_PUBLIC_KEY, licenseData.signature, 'base64');
        } catch (_) {
            isSignatureValid = false;
        }

        if (!isSignatureValid) {
            return {
                valid: false,
                error: 'Cryptographic signature verification failed (Tampered or counterfeit license key)',
                machineCode: currentMachineCode,
                tampered: true
            };
        }

        // 2. Clock Rollback Guard
        const clockCheck = verifyClockIntegrity();
        if (!clockCheck.valid) {
            return {
                valid: false,
                error: clockCheck.error,
                machineCode: currentMachineCode,
                clockTampered: true
            };
        }

        // 3. Product Identifier Check (Prevent license cross-use between different products)
        if (licenseData.payload.product !== 'RK-FG-DISPATCH-MANAGEMENT-SYSTEM') {
            return {
                valid: false,
                error: `Product Mismatch: License issued for "${licenseData.payload.product || 'Unknown'}"`,
                machineCode: currentMachineCode,
                productMismatch: true
            };
        }

        // 4. Hardware Lock Check
        if (licenseData.payload.machineCode !== currentMachineCode) {
            return {
                valid: false,
                error: `Hardware Lock Mismatch! License issued for ${licenseData.payload.machineCode}, but current machine is ${currentMachineCode}`,
                machineCode: currentMachineCode,
                licensedMachineCode: licenseData.payload.machineCode,
                hardwareMismatch: true
            };
        }

        // 5. Expiration Date Check
        if (licenseData.payload.expiresAt !== 'PERPETUAL') {
            const expDate = new Date(licenseData.payload.expiresAt);
            if (isNaN(expDate.getTime()) || new Date() > expDate) {
                return {
                    valid: false,
                    error: `License expired on ${licenseData.payload.expiresAt}. Please contact vendor for renewal.`,
                    machineCode: currentMachineCode,
                    expired: true,
                    expiresAt: licenseData.payload.expiresAt
                };
            }
        }

        return {
            valid: true,
            payload: licenseData.payload,
            machineCode: currentMachineCode,
            message: `Licensed to ${licenseData.payload.customerName} (Expires: ${licenseData.payload.expiresAt})`
        };
    } catch (err) {
        return {
            valid: false,
            error: `License validation failed: ${err.message}`,
            machineCode: getMachineFingerprint()
        };
    }
}

function getLicenseCandidates() {
    const root = getAppRootDir();
    const list = [
        path.join(root, 'license.key'),
        path.join(process.cwd(), 'license.key'),
        path.join(__dirname, '../../license.key'),
        path.join(__dirname, '../license.key')
    ];
    return [...new Set(list)].filter(Boolean);
}

/**
 * Activate and save license key file
 */
function activateLicense(licenseString, targetDir = getAppRootDir()) {
    const res = validateLicense(licenseString);
    if (!res.valid) {
        throw new Error(res.error);
    }

    const keyFilePath = path.join(targetDir, 'license.key');
    fs.writeFileSync(keyFilePath, licenseString.trim(), 'utf8');
    return res;
}

module.exports = {
    getMachineFingerprint,
    generateLicenseKey,
    validateLicense,
    activateLicense,
    getAppRootDir,
    getLicenseCandidates,
    VENDOR_PUBLIC_KEY
};
