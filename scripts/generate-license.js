// scripts/generate-license.js - Interactive & CLI Cryptographic License Generator
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { getMachineFingerprint, generateLicenseKey, validateLicense } = require('../src/utils/licenseEngine');

const rootDir = path.resolve(__dirname, '..');
const currentMachine = getMachineFingerprint();

const FEATURE_TIERS = {
    enterprise: {
        name: 'Enterprise Full (All Features)',
        features: ['FIFO_DISPATCH', 'REPORTS', 'TRACEABILITY', 'MANAGER_REOPEN', 'CSV_EXPORT', 'API_ACCESS']
    },
    standard: {
        name: 'Standard Commercial (Dispatch + Reports + Trace)',
        features: ['FIFO_DISPATCH', 'REPORTS', 'TRACEABILITY', 'CSV_EXPORT']
    },
    trial: {
        name: 'Evaluation / Trial (Core Dispatch Only)',
        features: ['FIFO_DISPATCH', 'TRACEABILITY']
    }
};

function calculateExpiry(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

// Check for command line flags for non-interactive/scripted usage
const args = process.argv.slice(2);
const isNonInteractive = args.length > 0;

if (isNonInteractive) {
    runCliMode();
} else {
    runInteractiveWizard();
}

function runCliMode() {
    let machineCode = '';
    let customerName = 'Mahindra & Mahindra';
    let expiresAt = '2028-12-31';
    let tier = 'enterprise';
    let outputFile = path.join(rootDir, 'license.key');

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--machine' && args[i + 1]) {
            machineCode = args[i + 1];
            i++;
        } else if (args[i] === '--customer' && args[i + 1]) {
            customerName = args[i + 1];
            i++;
        } else if (args[i] === '--expires' && args[i + 1]) {
            expiresAt = args[i + 1];
            i++;
        } else if (args[i] === '--trial') {
            const days = parseInt(args[i + 1] || '14', 10);
            expiresAt = calculateExpiry(isNaN(days) ? 14 : days);
            tier = 'trial';
            if (!isNaN(days)) i++;
        } else if (args[i] === '--tier' && args[i + 1]) {
            tier = args[i + 1].toLowerCase();
            i++;
        } else if (args[i] === '--out' && args[i + 1]) {
            outputFile = path.resolve(args[i + 1]);
            i++;
        }
    }

    if (!machineCode) machineCode = currentMachine;
    const selectedTier = FEATURE_TIERS[tier] || FEATURE_TIERS.enterprise;

    outputLicense(machineCode, customerName, expiresAt, selectedTier.features, outputFile);
}

async function runInteractiveWizard() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const ask = (query, defaultVal) => new Promise(resolve => {
        const promptText = defaultVal ? `${query} [${defaultVal}]: ` : `${query}: `;
        rl.question(promptText, (answer) => {
            resolve(answer.trim() || defaultVal || '');
        });
    });

    console.clear();
    console.log('================================================================');
    console.log('   RK FG DISPATCH MANAGEMENT SYSTEM - LICENSE GENERATOR');
    console.log('   Vendor Cryptographic HMAC-SHA256 Licensing Tool');
    console.log('================================================================');
    console.log(`Host Machine Code Detected: \x1b[36m${currentMachine}\x1b[0m\n`);

    // 1. Target Machine Code
    console.log('--- 1. TARGET HARDWARE ---');
    console.log('Press ENTER to license this computer, or paste the client\'s Machine Fingerprint.');
    let machineCode = await ask('Client Machine Fingerprint', currentMachine);
    machineCode = machineCode.toUpperCase().trim();

    // 2. Customer / Facility Name
    console.log('\n--- 2. CUSTOMER & FACILITY DETAILS ---');
    const customerName = await ask('Customer / Facility Name', 'Mahindra & Mahindra Ltd');

    // 3. License Duration / Expiry
    console.log('\n--- 3. LICENSE DURATION & EXPIRY ---');
    console.log('  [1] 14-Day Free Trial       (Expires: ' + calculateExpiry(14) + ')');
    console.log('  [2] 30-Day Evaluation       (Expires: ' + calculateExpiry(30) + ')');
    console.log('  [3] 90-Day Pilot Deployment (Expires: ' + calculateExpiry(90) + ')');
    console.log('  [4] 1-Year Commercial       (Expires: ' + calculateExpiry(365) + ')');
    console.log('  [5] 3-Year Enterprise       (Expires: ' + calculateExpiry(365 * 3) + ')');
    console.log('  [6] Perpetual (Lifetime - No Expiry)');
    console.log('  [7] Custom Date (YYYY-MM-DD)');

    const durationChoice = await ask('Select option (1-7)', '4');
    let expiresAt = calculateExpiry(365);

    if (durationChoice === '1') expiresAt = calculateExpiry(14);
    else if (durationChoice === '2') expiresAt = calculateExpiry(30);
    else if (durationChoice === '3') expiresAt = calculateExpiry(90);
    else if (durationChoice === '4') expiresAt = calculateExpiry(365);
    else if (durationChoice === '5') expiresAt = calculateExpiry(365 * 3);
    else if (durationChoice === '6') expiresAt = 'PERPETUAL';
    else if (durationChoice === '7') {
        expiresAt = await ask('Enter custom expiry date (YYYY-MM-DD)', calculateExpiry(180));
    }

    // 4. Feature Tier
    console.log('\n--- 4. FEATURE TIER ---');
    console.log('  [1] Enterprise Full (Dispatch, Traceability, Full Reports, Manager Reopen, CSV)');
    console.log('  [2] Standard Commercial (Dispatch, Traceability, Reports, CSV)');
    console.log('  [3] Trial Tier (Basic Dispatch + Traceability)');

    const tierChoice = await ask('Select option (1-3)', durationChoice === '1' ? '3' : '1');
    let selectedTier = FEATURE_TIERS.enterprise;
    if (tierChoice === '2') selectedTier = FEATURE_TIERS.standard;
    else if (tierChoice === '3') selectedTier = FEATURE_TIERS.trial;

    // 5. Output Destination
    console.log('\n--- 5. OUTPUT DESTINATION ---');
    console.log('  [1] Deploy to release & root (dist/release/license.key & ./license.key)');
    console.log('  [2] Save to licenses/ folder (<Customer>-<Machine>.key)');
    console.log('  [3] Custom file path');

    const destChoice = await ask('Select option (1-3)', '1');
    let outPaths = [];

    if (destChoice === '1') {
        outPaths.push(path.join(rootDir, 'license.key'));
        const releaseDir = path.join(rootDir, 'dist', 'release');
        if (fs.existsSync(releaseDir)) {
            outPaths.push(path.join(releaseDir, 'license.key'));
        }
    } else if (destChoice === '2') {
        const safeName = customerName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const shortMachine = machineCode.slice(-9).replace('-', '');
        const licFolder = path.join(rootDir, 'licenses');
        if (!fs.existsSync(licFolder)) fs.mkdirSync(licFolder, { recursive: true });
        outPaths.push(path.join(licFolder, `${safeName}_${shortMachine}_license.key`));
    } else {
        const customPath = await ask('Enter destination file path', path.join(rootDir, 'license.key'));
        outPaths.push(path.resolve(customPath));
    }

    rl.close();

    // Generate and write
    for (const p of outPaths) {
        outputLicense(machineCode, customerName, expiresAt, selectedTier.features, p);
    }
}

function outputLicense(machineCode, customerName, expiresAt, features, outputFile) {
    try {
        const keyBase64 = generateLicenseKey({
            machineCode,
            customerName,
            expiresAt,
            features
        });

        const targetDir = path.dirname(outputFile);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        fs.writeFileSync(outputFile, keyBase64, 'utf8');

        // Verification check
        const test = validateLicense(keyBase64);

        console.log('\n================================================================');
        console.log('  \x1b[32m✔ LICENSE KEY GENERATED SUCCESSFULLY!\x1b[0m');
        console.log('================================================================');
        console.log(`  File Saved:      \x1b[33m${outputFile}\x1b[0m`);
        console.log(`  Customer:        ${customerName}`);
        console.log(`  Machine Code:    \x1b[36m${machineCode}\x1b[0m`);
        console.log(`  Expiration:      \x1b[35m${expiresAt}\x1b[0m`);
        console.log(`  Features:        ${features.join(', ')}`);
        console.log(`  Verification:    \x1b[32m${test.valid ? 'VALID (HMAC-SHA256 Cryptographically Signed)' : 'INVALID'}\x1b[0m`);
        console.log('================================================================\n');
    } catch (err) {
        console.error(`\n[ERROR] Failed to generate license: ${err.message}`);
    }
}
