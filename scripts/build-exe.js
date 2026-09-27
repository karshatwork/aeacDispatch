const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'dist', 'host');
const srcCs = path.join(rootDir, 'desktop-host', 'Program.cs');
const iconPath = path.join(rootDir, 'assets', 'app.ico');
const exeTarget = path.join(outDir, 'DispatchManager.exe');

console.log('====================================================');
console.log('  BUILDING STANDALONE C# DESKTOP HOST (.EXE)');
console.log('====================================================');

fs.mkdirSync(outDir, { recursive: true });

// Check for csc.exe (standard on all Windows .NET Framework installations)
const cscPaths = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
];

let cscExe = cscPaths.find(p => fs.existsSync(p));

if (cscExe) {
    console.log(`Found Windows C# Compiler: ${cscExe}`);
    const iconArg = fs.existsSync(iconPath) ? `/win32icon:"${iconPath}"` : '';
    const cmd = `"${cscExe}" /nologo /target:winexe ${iconArg} /out:"${exeTarget}" /r:System.dll,System.Core.dll,System.Windows.Forms.dll,System.Drawing.dll "${srcCs}"`;
    try {
        execSync(cmd, { stdio: 'inherit', cwd: rootDir });
        console.log(`[SUCCESS] Standalone executable compiled: ${exeTarget}`);
        process.exit(0);
    } catch (err) {
        console.error(`[ERROR] csc.exe compilation failed: ${err.message}`);
    }
}

// Fallback to dotnet if csc not found or failed
try {
    const csprojPath = path.join(rootDir, 'desktop-host', 'DispatchHost.csproj');
    const cmd = `dotnet publish "${csprojPath}" -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o "${outDir}"`;
    execSync(cmd, { stdio: 'inherit', cwd: rootDir });
    console.log(`[SUCCESS] Dotnet publish completed: ${exeTarget}`);
} catch (err) {
    console.error(`[BUILD FAILED] Could not build DispatchManager.exe: ${err.message}`);
    process.exit(1);
}
