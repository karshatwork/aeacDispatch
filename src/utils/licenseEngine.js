// src/utils/licenseEngine.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Master private vendor secret for signing license keys
const VENDOR_SECRET = 'AEAC_ELEKTROSIL_DISPATCH_SIGNING_KEY_9882_2026';

/**
 * Retrieve unique hardware fingerprint on Windows (Motherboard UUID + CPU ID + Network MAC)
 * Formats as readable Machine Code: AEAC-XXXX-YYYY-ZZZZ-WWWW
 */
function getMachineFingerprint() {
    let rawHardwareId = '';

    if (process.platform === 'win32') {
        try {
            // Read Motherboard UUID
            const boardOutput = execSync('wmic baseboard get serialnumber /format:list', { stdio: ['pipe', 'pipe', 'ignore'], timeout: 2000 }).toString();
            rawHardwareId += boardOutput.replace(/SerialNumber=/gi, '').trim();
        } catch (e) {}

        try {
            // Read Processor ID
            const cpuOutput = execSync('wmic cpu get processorid /format:list', { stdio: ['pipe', 'pipe', 'ignore'], timeout: 2000 }).toString();
            rawHardwareId += cpuOutput.replace(/ProcessorId=/gi, '').trim();
        } catch (e) {}
    }

    // Include primary MAC address & hostname fallback
    const networkInterfaces = os.networkInterfaces();
    for (const name of Object.keys(networkInterfaces)) {
        for (const net of networkInterfaces[name]) {
            if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
                rawHardwareId += net.mac;
                break;
            }
        }
    }

    if (!rawHardwareId) {
        rawHardwareId = os.hostname() + '-' + os.platform() + '-' + os.arch();
    }

    // SHA-256 hash formatted into 4 groups of 4 uppercase hex characters
    const hash = crypto.createHash('sha256').update(rawHardwareId).digest('hex').toUpperCase();
    return `RKFG-${hash.substring(0, 4)}-${hash.substring(4, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}`;
}


/**
 * Generate a cryptographically signed license key for a specific machine
 */
function generateLicenseKey({
    machineCode,
    customerName = 'Mahindra',
    expiresAt = '2027-12-31',
    features = ['FIFO_DISPATCH', 'REPORTS', 'TRACEABILITY', 'MANAGER_REOPEN', 'CSV_EXPORT'],
    secret = VENDOR_SECRET
}) {
    if (!machineCode || (!machineCode.startsWith('RKFG-') && !machineCode.startsWith('AEAC-'))) {
        throw new Error('Valid machine code in format RKFG-XXXX-YYYY-ZZZZ-WWWW is required');
    }

    const payload = {
        product: 'RK-FG-DISPATCH-MANAGEMENT-SYSTEM',

        machineCode: machineCode.toUpperCase().trim(),
        customerName,
        issuedAt: new Date().toISOString().slice(0, 10),
        expiresAt, // YYYY-MM-DD or 'PERPETUAL'
        features,
        version: '1.0.0'
    };

    const payloadJson = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', secret).update(payloadJson).digest('hex');

    const licenseData = {
        payload,
        signature
    };

    return Buffer.from(JSON.stringify(licenseData, null, 2)).toString('base64');
}

/**
 * Validate license payload against current machine hardware
 */
function validateLicense(licenseBase64OrPath, secret = VENDOR_SECRET) {
    try {
        let licenseStr = '';
        if (fs.existsSync(licenseBase64OrPath)) {
            licenseStr = fs.readFileSync(licenseBase64OrPath, 'utf8').trim();
        } else {
            licenseStr = licenseBase64OrPath.trim();
        }

        if (!licenseStr) {
            return { valid: false, error: 'License file is empty or missing' };
        }

        // Decode Base64
        const decodedJson = Buffer.from(licenseStr, 'base64').toString('utf8');
        const licenseData = JSON.parse(decodedJson);

        if (!licenseData.payload || !licenseData.signature) {
            return { valid: false, error: 'Malformed license structure' };
        }

        // Verify cryptographic signature
        const expectedSig = crypto.createHmac('sha256', secret).update(JSON.stringify(licenseData.payload)).digest('hex');
        if (expectedSig !== licenseData.signature) {
            return { valid: false, error: 'Invalid license signature (Tampered license file)' };
        }

        // Verify Hardware Lock
        const currentMachineCode = getMachineFingerprint();
        if (licenseData.payload.machineCode !== currentMachineCode) {
            return {
                valid: false,
                error: `Hardware Lock Mismatch! License issued for ${licenseData.payload.machineCode}, but current machine is ${currentMachineCode}`,
                currentMachineCode,
                licensedMachineCode: licenseData.payload.machineCode
            };
        }

        // Verify Expiration Date
        if (licenseData.payload.expiresAt !== 'PERPETUAL') {
            const expDate = new Date(licenseData.payload.expiresAt);
            if (isNaN(expDate.getTime()) || new Date() > expDate) {
                return {
                    valid: false,
                    error: `License has expired on ${licenseData.payload.expiresAt}. Please contact vendor for renewal.`,
                    expired: true
                };
            }
        }

        return {
            valid: true,
            payload: licenseData.payload,
            message: `Licensed to ${licenseData.payload.customerName} (Expires: ${licenseData.payload.expiresAt})`
        };
    } catch (err) {
        return { valid: false, error: `License validation failed: ${err.message}` };
    }
}

/**
 * Determine root application directory across packaged Electron release and development
 */
function getAppRootDir() {
    if (process.resourcesPath && !process.resourcesPath.includes('node_modules')) {
        return path.dirname(process.resourcesPath);
    }
    return process.cwd();
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
    VENDOR_SECRET
};
