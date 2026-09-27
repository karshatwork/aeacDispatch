// scripts/build-release.js
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const bytenode = require('bytenode');
const { ZipArchive } = require('archiver');
const { execSync } = require('child_process');
const { encryptConfig, saveEncryptedConfig } = require('../src/utils/cryptoConfig');
const { getMachineFingerprint, generateLicenseKey, validateLicense } = require('../src/utils/licenseEngine');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const bundleDir = path.join(distDir, 'bundle');
const releaseDir = path.join(distDir, 'release');
const pkg = require(path.join(rootDir, 'package.json'));

console.log('====================================================');
console.log(`  PACKAGING RK FG DISPATCH SYSTEM RELEASE v${pkg.version}`);
console.log('====================================================');


// 1. Clean dist/release and dist/bundle safely
function cleanDirectorySafely(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        return;
    }
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
        if (entry === 'node_modules') continue; // Retain node_modules to avoid re-installing
        const full = path.join(dir, entry);
        try {
            fs.rmSync(full, { recursive: true, force: true });
        } catch (e) {
            // File might be open in IDE
        }
    }
}

cleanDirectorySafely(releaseDir);
cleanDirectorySafely(bundleDir);

// 2. Build C# Host Executable (DispatchManager.exe with Windows Kernel Job Object)
console.log('\n[1/8] Compiling native Windows C# host executable...');
try {
    try {
        execSync('powershell -Command "Stop-Process -Name DispatchManager -Force -ErrorAction SilentlyContinue"', { stdio: 'ignore' });
    } catch (e) {}

    execSync('node scripts/build-exe.js', { stdio: 'inherit', cwd: rootDir });
    const hostExe = path.join(distDir, 'host', 'DispatchManager.exe');
    if (!fs.existsSync(hostExe)) {
        throw new Error('DispatchManager.exe not found after compilation!');
    }
    fs.copyFileSync(hostExe, path.join(releaseDir, 'DispatchManager.exe'));
    console.log('  [OK] Copied DispatchManager.exe to release directory');
} catch (err) {
    console.error(`  [FATAL ERROR] Failed to compile DispatchManager.exe: ${err.message}`);
    process.exit(1);
}

// 3. Embed Node.js binary directly into release directory
console.log('\n[2/8] Embedding Node.js runtime binary...');
const nodeExecPath = process.execPath;
console.log(`  Found Node.js binary: ${nodeExecPath}`);
const targetNodePath = path.join(releaseDir, 'node.exe');
fs.copyFileSync(nodeExecPath, targetNodePath);
const nodeStats = fs.statSync(targetNodePath);
console.log(`  [OK] Embedded node.exe (${(nodeStats.size / (1024 * 1024)).toFixed(1)} MB) into release directory`);

// 4. Bundle entire application into a single file with esbuild
console.log('\n[3/8] Bundling application source into single file with esbuild...');
const bundleFile = path.join(bundleDir, 'app-bundle.js');
try {
    esbuild.buildSync({
        entryPoints: [path.join(rootDir, 'src', 'server.js')],
        bundle: true,
        platform: 'node',
        target: 'node18',
        packages: 'external',
        outfile: bundleFile,
        minify: false,
        sourcemap: false
    });
    const bundleStats = fs.statSync(bundleFile);
    console.log(`  [OK] Single application bundle created: ${(bundleStats.size / 1024).toFixed(1)} KB`);
} catch (err) {
    console.error(`  [FATAL ERROR] esbuild bundling failed: ${err.message}`);
    process.exit(1);
}

// 5. Compile single bundle into single bytecode file (app.jsc) with Bytenode
console.log('\n[4/8] Compiling application bundle to single Bytenode bytecode (.jsc)...');
const targetJsc = path.join(releaseDir, 'app.jsc');
try {
    bytenode.compileFile({
        filename: bundleFile,
        output: targetJsc,
        compileAsModule: true
    });
    console.log('  [OK] Consolidated bytecode compiled: app.jsc');

    // Create entry-point loader in release/server.js
    const loaderContent = `// RK FG Dispatch System - Bytecode Loader
require('bytenode');
const bundle = require('./app.jsc');
if (bundle && typeof bundle.bootstrap === 'function') {
    bundle.bootstrap().catch(err => {
        console.error('[FATAL STARTUP ERROR]', err);
    });
}
`;
    fs.writeFileSync(path.join(releaseDir, 'server.js'), loaderContent, 'utf8');
    console.log('  [OK] Created entry-point loader: server.js');
} catch (err) {
    console.error(`  [FATAL ERROR] Bytecode compilation failed: ${err.message}`);
    process.exit(1);
}

// 6. Generate Encrypted Configuration (config.enc) - NO raw .env in release!
console.log('\n[5/8] Creating AES-256-GCM encrypted configuration (config.enc)...');
const envPath = path.join(rootDir, '.env');
const envExamplePath = path.join(rootDir, '.env.example');

let configObj = {
    NODE_ENV: 'production',
    PORT: '4000',
    MONGO_URI: 'mongodb://localhost:27017/plc_sticker',
    JWT_SECRET: 'AEAC_INDUSTRIAL_SECRET_KEY_2026_DISPATCH_PROD',
    COM_PORT: 'COM3',
    COM_BAUD_RATE: '9600',
    SYNC_INTERVAL_MS: '3000',
    WATERMARK_INITIAL_LOOKBACK_HOURS: '72'
};

const sourceEnvFile = fs.existsSync(envPath) ? envPath : (fs.existsSync(envExamplePath) ? envExamplePath : null);
if (sourceEnvFile) {
    const rawLines = fs.readFileSync(sourceEnvFile, 'utf8').split(/\r?\n/);
    for (const line of rawLines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const idx = trimmed.indexOf('=');
            const k = trimmed.substring(0, idx).trim();
            const v = trimmed.substring(idx + 1).trim();
            if (k) configObj[k] = v;
        }
    }
}

// Strictly enforce NODE_ENV=production ONLY in release bundle
const releaseConfig = { ...configObj, NODE_ENV: 'production' };

const encOutPath = path.join(releaseDir, 'config.enc');
saveEncryptedConfig(encOutPath, releaseConfig);
console.log('  [OK] Encrypted configuration saved to release config.enc (NODE_ENV=production, AES-256-GCM)');
console.log('  [OK] Plain-text .env intentionally omitted from release for security');

// Preserve root config.enc for local development (development mode)
const devConfig = { ...configObj, NODE_ENV: 'development' };
saveEncryptedConfig(path.join(rootDir, 'config.enc'), devConfig);


// 7. Embed Hardware License Key
console.log('\n[6/8] Generating and embedding cryptographic hardware license key...');
let licenseKeyPath = path.join(rootDir, 'license.key');
if (!fs.existsSync(licenseKeyPath)) {
    const machineCode = getMachineFingerprint();
    console.log(`  Generating default license for machine: ${machineCode}...`);
    const keyContent = generateLicenseKey({
        machineCode,
        customerName: 'Mahindra & Mahindra',
        expiresAt: '2028-12-31'
    });
    fs.writeFileSync(licenseKeyPath, keyContent, 'utf8');
}
fs.copyFileSync(licenseKeyPath, path.join(releaseDir, 'license.key'));
const testLic = validateLicense(licenseKeyPath);
console.log(`  [OK] license.key bundled (Status: ${testLic.valid ? 'VALID - ' + testLic.message : 'INVALID: ' + testLic.error})`);

// 8. Copy Offline UI, Assets & Production node_modules
console.log('\n[7/8] Copying offline UI, fonts, icons, assets, and dependencies...');
function copyRecursive(src, dest) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcP = path.join(src, entry.name);
        const destP = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyRecursive(srcP, destP);
        } else {
            fs.copyFileSync(srcP, destP);
        }
    }
}

copyRecursive(path.join(rootDir, 'public'), path.join(releaseDir, 'public'));
copyRecursive(path.join(rootDir, 'assets'), path.join(releaseDir, 'assets'));

// Write production package.json
const prodPkg = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    main: "server.js",
    dependencies: {
        ...pkg.dependencies,
        bytenode: "^1.7.0"
    }
};
fs.writeFileSync(path.join(releaseDir, 'package.json'), JSON.stringify(prodPkg, null, 2), 'utf8');

// Install clean production dependencies
console.log('  Installing production node_modules in release package...');
try {
    execSync(`npm install --omit=dev --no-audit --no-fund --prefix "${releaseDir}"`, { stdio: 'inherit', cwd: rootDir });
} catch (e) {
    console.log('  Copying node_modules fallback...');
    const nodeModulesSrc = path.join(rootDir, 'node_modules');
    if (fs.existsSync(nodeModulesSrc)) {
        copyRecursive(nodeModulesSrc, path.join(releaseDir, 'node_modules'));
    }
}

// 9. Create Distribution ZIP Archive
console.log('\n[8/8] Creating distribution ZIP archive with archiver...');
const zipFileName = `RK-FG-Dispatch-v${pkg.version}.zip`;
const zipFilePath = path.join(distDir, zipFileName);


if (fs.existsSync(zipFilePath)) {
    fs.unlinkSync(zipFilePath);
}

const outputStream = fs.createWriteStream(zipFilePath);
const archive = new ZipArchive({ zlib: { level: 6 } });

outputStream.on('close', () => {
    const sizeMb = (archive.pointer() / (1024 * 1024)).toFixed(2);
    console.log('====================================================');
    console.log(`[RELEASE SUCCESSFUL]`);
    console.log(`  Package Folder: ${releaseDir}`);
    console.log(`  Executable:     ${path.join(releaseDir, 'DispatchManager.exe')}`);
    console.log(`  Embedded Node:  ${path.join(releaseDir, 'node.exe')}`);
    console.log(`  Bytecode:       ${path.join(releaseDir, 'app.jsc')} (Single compiled bundle)`);
    console.log(`  Encrypted Env:  ${path.join(releaseDir, 'config.enc')}`);
    console.log(`  License:        ${path.join(releaseDir, 'license.key')}`);
    console.log(`  Archive ZIP:    ${zipFilePath} (${sizeMb} MB)`);
    console.log('====================================================');
});

archive.on('error', (err) => {
    console.error('[ZIP FAILED]', err.message);
    process.exit(1);
});

archive.pipe(outputStream);
archive.directory(releaseDir, false);
archive.finalize();
