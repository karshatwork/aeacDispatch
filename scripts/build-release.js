// scripts/build-release.js - Standalone Electron Bytenode Production Release Pipeline
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { ZipArchive } = require('archiver');
const { rcedit } = require('rcedit');
const { execSync, execFileSync } = require('child_process');
const { encryptConfig, saveEncryptedConfig } = require('../src/utils/cryptoConfig');
const { getMachineFingerprint, generateLicenseKey, validateLicense } = require('../src/utils/licenseEngine');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const bundleDir = path.join(distDir, 'bundle');
const releaseDir = path.join(distDir, 'release');
const appResourceDir = path.join(releaseDir, 'resources', 'app');
const pkg = require(path.join(rootDir, 'package.json'));

console.log('====================================================');
console.log(`  PACKAGING STANDALONE ELECTRON RELEASE v${pkg.version}`);
console.log('  RUNTIME: Electron + Bytenode V8 Protected Engine');
console.log('====================================================');

// Helper: safe recursive copy
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

// 1. Terminate running instances and clean
console.log('\n[1/9] Cleaning previous release artifacts...');
try {
  execSync('powershell -Command "Stop-Process -Name DispatchManager -Force -ErrorAction SilentlyContinue"', { stdio: 'ignore' });
} catch (e) {}

function cleanDirectorySafely(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry);
    try {
      fs.rmSync(full, { recursive: true, force: true });
    } catch (e) {}
  }
}

cleanDirectorySafely(bundleDir);
cleanDirectorySafely(releaseDir);

// 2. Copy Electron distribution runtime
console.log('\n[2/9] Deploying standalone Electron desktop runtime...');
const electronDistDir = path.dirname(require('electron'));
console.log(`  Source Electron runtime: ${electronDistDir}`);
copyRecursive(electronDistDir, releaseDir);

// Rename electron.exe to DispatchManager.exe
const sourceExe = path.join(releaseDir, 'electron.exe');
const targetExe = path.join(releaseDir, 'DispatchManager.exe');
if (fs.existsSync(sourceExe)) {
  fs.renameSync(sourceExe, targetExe);
  console.log('  [OK] Renamed runtime to DispatchManager.exe');
}

// Remove default_app.asar to ensure custom app loads
const defaultAppAsar = path.join(releaseDir, 'resources', 'default_app.asar');
if (fs.existsSync(defaultAppAsar)) {
  fs.unlinkSync(defaultAppAsar);
  console.log('  [OK] Removed default Electron application wrapper');
}

// Ensure resources/app directory exists
fs.mkdirSync(appResourceDir, { recursive: true });

// 3. Patch DispatchManager.exe binary metadata with rcedit
console.log('\n[3/9] Injecting application branding, icon, and metadata into DispatchManager.exe...');
const appIcoPath = path.join(rootDir, 'assets', 'app.ico');

(async () => {
  try {
    if (fs.existsSync(appIcoPath)) {
      await rcedit(targetExe, {
        icon: appIcoPath,
        'file-version': pkg.version,
        'product-version': pkg.version,
        'version-string': {
          ProductName: 'RecordKeeper Dispatch',
          FileDescription: 'RecordKeeper Dispatch - Dispatch Management System',
          CompanyName: 'Karsh Industrial Digital Solutions',
          LegalCopyright: 'Copyright © 2026 Karsh',
          OriginalFilename: 'DispatchManager.exe'
        }
      });
      console.log('  [OK] Successfully injected custom icon and product metadata');
    }
  } catch (err) {
    console.warn(`  [WARNING] rcedit metadata injection: ${err.message}`);
  }

  // 4. Bundle application sources with esbuild
  console.log('\n[4/9] Bundling application modules with esbuild...');
  const serverBundlePath = path.join(bundleDir, 'server-bundle.js');
  const mainBundlePath = path.join(bundleDir, 'main-bundle.js');

  try {
    // Bundle backend server
    esbuild.buildSync({
      entryPoints: [path.join(rootDir, 'src', 'server.js')],
      bundle: true,
      platform: 'node',
      target: 'node22',
      packages: 'external',
      outfile: serverBundlePath,
      minify: false,
      sourcemap: false
    });
    console.log('  [OK] Server logic bundled (server-bundle.js)');

    // Bundle Electron main process
    esbuild.buildSync({
      entryPoints: [path.join(rootDir, 'src', 'desktop', 'main.js')],
      bundle: true,
      platform: 'node',
      target: 'node22',
      packages: 'external',
      outfile: mainBundlePath,
      minify: false,
      sourcemap: false
    });
    console.log('  [OK] Electron host process bundled (main-bundle.js)');
  } catch (err) {
    console.error(`  [FATAL ERROR] esbuild bundling failed: ${err.message}`);
    process.exit(1);
  }

  // 5. Compile bundles into V8 bytecode (.jsc) with Bytenode using Electron's runtime
  console.log('\n[5/9] Compiling bundles to V8 bytecode (.jsc) via Electron runtime...');
  const serverJscPath = path.join(appResourceDir, 'server.jsc');
  const mainJscPath = path.join(appResourceDir, 'main.jsc');

  // Electron executable path used for exact V8 version compilation
  const electronExe = targetExe;

  const compileScript = `
    const bytenode = require('bytenode');
    bytenode.compileFile({ filename: ${JSON.stringify(serverBundlePath)}, output: ${JSON.stringify(serverJscPath)}, compileAsModule: true });
    bytenode.compileFile({ filename: ${JSON.stringify(mainBundlePath)}, output: ${JSON.stringify(mainJscPath)}, compileAsModule: true });
    process.exit(0);
  `;

  try {
    execFileSync(electronExe, ['-e', compileScript], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit'
    });
    console.log('  [OK] server.jsc compiled successfully');
    console.log('  [OK] main.jsc compiled successfully');
  } catch (err) {
    console.error(`  [FATAL ERROR] Bytenode compilation failed: ${err.message}`);
    process.exit(1);
  }

  // Write Electron entry loader (main.js)
  const mainLoader = `// Standalone Electron Bytenode Loader
require('bytenode');
require('./main.jsc');
`;
  fs.writeFileSync(path.join(appResourceDir, 'main.js'), mainLoader, 'utf8');

  // Write Server loader (server.js)
  const serverLoader = `// Standalone Backend Bytenode Loader
require('bytenode');
module.exports = require('./server.jsc');
`;
  fs.writeFileSync(path.join(appResourceDir, 'server.js'), serverLoader, 'utf8');

  // Copy preload.js
  const preloadSrc = path.join(rootDir, 'src', 'desktop', 'preload.js');
  if (fs.existsSync(preloadSrc)) {
    fs.copyFileSync(preloadSrc, path.join(appResourceDir, 'preload.js'));
    console.log('  [OK] Embedded preload.js');
  }

  // 6. Copy frontend UI, icons, fonts, assets
  console.log('\n[6/9] Copying frontend UI, Remixicon fonts, and branding assets...');
  copyRecursive(path.join(rootDir, 'public'), path.join(appResourceDir, 'public'));
  copyRecursive(path.join(rootDir, 'assets'), path.join(appResourceDir, 'assets'));
  console.log('  [OK] public/ and assets/ copied to app resources');

  // 7. Configure production package.json and node_modules
  console.log('\n[7/9] Packaging production node_modules into app resources...');
  const appPkg = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    main: "main.js",
    dependencies: {
      ...pkg.dependencies,
      bytenode: "^1.7.0"
    }
  };
  delete appPkg.dependencies['remixicon'];
  delete appPkg.dependencies['chart.js'];

  fs.writeFileSync(path.join(appResourceDir, 'package.json'), JSON.stringify(appPkg, null, 2), 'utf8');

  console.log('  Installing clean production dependencies into release package...');
  try {
    execSync(`npm install --omit=dev --no-audit --no-fund --prefer-offline --prefix "${appResourceDir}"`, { stdio: 'inherit', cwd: rootDir });
    console.log('  [OK] Production node_modules installed successfully');
  } catch (err) {
    console.warn('  [WARN] npm install failed, falling back to copyRecursive:', err.message);
    const srcNodeModules = path.join(rootDir, 'node_modules');
    const targetNodeModules = path.join(appResourceDir, 'node_modules');
    copyRecursive(srcNodeModules, targetNodeModules);
  }

  // 8. Generate Encrypted Configuration (config.enc) & Hardware License
  console.log('\n[8/9] Generating encrypted configuration and hardware license...');
  const envPath = path.join(rootDir, '.env');
  const envExamplePath = path.join(rootDir, '.env.example');

  let configObj = {
    NODE_ENV: 'production',
    PORT: '4000',
    MONGO_URI: 'mongodb://localhost:27017/dispatch_db',
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

  const releaseConfig = { ...configObj, NODE_ENV: 'production' };
  const encOutPath = path.join(releaseDir, 'config.enc');
  saveEncryptedConfig(encOutPath, releaseConfig);
  console.log('  [OK] config.enc encrypted and placed in release root');

  // Copy or generate license.key
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

  // 9. Create Distribution ZIP Archive
  console.log('\n[9/9] Generating final release ZIP distribution package...');
  const zipFileName = `RK-FG-Dispatch-v${pkg.version}.zip`;
  const zipFilePath = path.join(distDir, zipFileName);

  if (fs.existsSync(zipFilePath)) {
    fs.unlinkSync(zipFilePath);
  }

  const outputStream = fs.createWriteStream(zipFilePath);
  const archive = new ZipArchive({ zlib: { level: 6 } });

  outputStream.on('close', () => {
    const sizeMb = (archive.pointer() / (1024 * 1024)).toFixed(2);
    console.log('\n====================================================');
    console.log('[RELEASE BUILD COMPLETE]');
    console.log(`  Executable:  ${targetExe}`);
    console.log(`  Bytecode:    ${mainJscPath} & ${serverJscPath}`);
    console.log(`  Config:      ${encOutPath} (AES-256-GCM encrypted)`);
    console.log(`  License:     ${path.join(releaseDir, 'license.key')}`);
    console.log(`  Package ZIP: ${zipFilePath} (${sizeMb} MB)`);
    console.log('====================================================\n');
  });

  archive.on('error', (err) => {
    console.error('[ZIP ERROR]', err.message);
    process.exit(1);
  });

  archive.pipe(outputStream);
  archive.directory(releaseDir, false);
  archive.finalize();
})();
