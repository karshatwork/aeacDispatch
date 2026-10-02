// scripts/edit-config.js
// Interactive CLI to decrypt, edit, and re-encrypt config.enc

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');
const {
    loadEncryptedConfig,
    saveEncryptedConfig,
    findConfigFile
} = require('../src/utils/cryptoConfig');

const CONFIG_ENC_PATH = findConfigFile('config.enc') || path.join(process.cwd(), 'config.enc');
const ENV_PATH = findConfigFile('.env') || path.join(process.cwd(), '.env');

function createRl() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

function promptQuestion(rl, query) {
    return new Promise((resolve) => rl.question(query, resolve));
}

function printHeader() {
    console.clear();
    console.log('\x1b[36m====================================================================\x1b[0m');
    console.log('\x1b[1m\x1b[32m       RECORDKEEPER FG DISPATCH — ENCRYPTED CONFIGURATION CLI        \x1b[0m');
    console.log('\x1b[36m====================================================================\x1b[0m');
    console.log(`\x1b[90mTarget Encrypted File:\x1b[0m \x1b[33m${CONFIG_ENC_PATH}\x1b[0m`);
    console.log(`\x1b[90mOptional Plain .env:  \x1b[0m \x1b[33${fs.existsSync(ENV_PATH) ? ENV_PATH : 'None'}\x1b[0m`);
    console.log('\x1b[36m--------------------------------------------------------------------\x1b[0m\n');
}

function displayConfigTable(config) {
    console.log('\x1b[1mCurrent Decrypted Parameters:\x1b[0m');
    const keys = Object.keys(config);
    if (keys.length === 0) {
        console.log('  \x1b[90m(Configuration is currently empty)\x1b[0m\n');
        return;
    }

    const maxKeyLen = Math.max(...keys.map(k => k.length), 10);
    keys.forEach((key, idx) => {
        const val = String(config[key]);
        const num = `[${idx + 1}]`.padEnd(5);
        const paddedKey = key.padEnd(maxKeyLen + 2);
        console.log(`  \x1b[32m${num}\x1b[0m \x1b[36m${paddedKey}\x1b[0m : \x1b[37m${val}\x1b[0m`);
    });
    console.log('');
}

function syncToEnvFile(config) {
    if (!fs.existsSync(ENV_PATH)) return;
    try {
        let content = '';
        for (const [k, v] of Object.entries(config)) {
            content += `${k}=${v}\n`;
        }
        fs.writeFileSync(ENV_PATH, content, 'utf8');
        console.log(`\x1b[90m(Also updated synchronized ${ENV_PATH})\x1b[0m`);
    } catch (e) {
        console.warn('Could not sync to .env file:', e.message);
    }
}

async function editInSystemEditor(config) {
    const tempFile = path.join(process.cwd(), '.temp_config_edit.json');
    try {
        fs.writeFileSync(tempFile, JSON.stringify(config, null, 2), 'utf8');

        console.log(`\n\x1b[33mOpening configuration in external editor...\x1b[0m`);
        console.log(`\x1b[90mSave and close the editor window to apply changes.\x1b[0m\n`);

        const isWindows = process.platform === 'win32';
        const editorCmd = process.env.EDITOR || (isWindows ? 'notepad.exe' : 'nano');

        spawnSync(editorCmd, [tempFile], { stdio: 'inherit', shell: true });

        const editedContent = fs.readFileSync(tempFile, 'utf8');
        const parsed = JSON.parse(editedContent);

        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('Edited configuration must be a valid JSON object');
        }

        console.log('\x1b[32m[OK] Successfully loaded and validated edited JSON!\x1b[0m');
        return parsed;
    } finally {
        if (fs.existsSync(tempFile)) {
            try { fs.unlinkSync(tempFile); } catch (e) { }
        }
    }
}

async function stepThroughAll(rl, config) {
    console.log('\n\x1b[1m\x1b[33mStep-Through Edit Mode\x1b[0m (press \x1b[1mEnter\x1b[0m to keep current value):');
    const updated = { ...config };

    for (const key of Object.keys(updated)) {
        const curVal = updated[key];
        const answer = await promptQuestion(rl, `  \x1b[36m${key}\x1b[0m [\x1b[90m${curVal}\x1b[0m]: `);
        if (answer.trim() !== '') {
            updated[key] = answer.trim();
        }
    }
    return updated;
}

const STANDARD_SCANNER_DEFAULTS = {
    COM_PORT: 'COM3',
    COM_BAUD_RATE: '9600',
    COM_DATA_BITS: '8',
    COM_PARITY: 'none',
    COM_STOP_BITS: '1',
    COM_DELIMITER: 'CRLF'
};

async function main() {
    let config = {};
    if (fs.existsSync(CONFIG_ENC_PATH)) {
        try {
            config = loadEncryptedConfig(CONFIG_ENC_PATH) || {};
        } catch (err) {
            console.error('\x1b[31m[ERROR] Failed to decrypt existing config.enc:\x1b[0m', err.message);
            console.log('Starting with a fresh empty configuration.');
        }
    } else if (fs.existsSync(ENV_PATH)) {
        // Fallback: parse .env if config.enc doesn't exist yet
        const dotenv = require('dotenv');
        config = dotenv.parse(fs.readFileSync(ENV_PATH, 'utf8')) || {};
    }

    let isDirty = false;

    // Ensure all standard industrial COM scanner parameters are visible & configurable
    for (const [key, defaultVal] of Object.entries(STANDARD_SCANNER_DEFAULTS)) {
        if (!(key in config)) {
            config[key] = defaultVal;
            isDirty = true;
        }
    }

    const rl = createRl();

    while (true) {
        printHeader();
        displayConfigTable(config);

        if (isDirty) {
            console.log('\x1b[33m* You have unsaved changes in memory.\x1b[0m\n');
        }

        console.log('\x1b[1mMenu Options:\x1b[0m');
        console.log('  \x1b[32m[1]\x1b[0m Step-through all parameters (Quick edit)');
        console.log('  \x1b[32m[2]\x1b[0m Edit a specific parameter by number/name');
        console.log('  \x1b[32m[3]\x1b[0m Add a new parameter');
        console.log('  \x1b[32m[4]\x1b[0m Delete a parameter');
        console.log('  \x1b[32m[5]\x1b[0m Open & edit in Text Editor (Notepad / VS Code)');
        console.log('  \x1b[32m[S]\x1b[0m \x1b[1m\x1b[32mSave & Encrypt to config.enc\x1b[0m');
        console.log('  \x1b[31m[Q]\x1b[0m Quit');

        const choice = (await promptQuestion(rl, '\nSelect an option: ')).trim().toLowerCase();

        if (choice === '1') {
            config = await stepThroughAll(rl, config);
            isDirty = true;
        } else if (choice === '2') {
            const target = (await promptQuestion(rl, 'Enter parameter number or exact name: ')).trim();
            const keys = Object.keys(config);
            const idx = parseInt(target, 10) - 1;
            const keyToEdit = (idx >= 0 && idx < keys.length) ? keys[idx] : target;

            if (keyToEdit && keyToEdit in config) {
                const newVal = await promptQuestion(rl, `Enter new value for \x1b[36m${keyToEdit}\x1b[0m (Current: \x1b[90m${config[keyToEdit]}\x1b[0m): `);
                if (newVal.trim() !== '') {
                    config[keyToEdit] = newVal.trim();
                    isDirty = true;
                }
            } else {
                console.log('\x1b[31mInvalid parameter selection.\x1b[0m');
                await promptQuestion(rl, 'Press Enter to continue...');
            }
        } else if (choice === '3') {
            const newKey = (await promptQuestion(rl, 'Enter NEW parameter name (e.g. MONGO_URI, PORT): ')).trim();
            if (newKey) {
                const newVal = await promptQuestion(rl, `Enter value for ${newKey}: `);
                config[newKey] = newVal.trim();
                isDirty = true;
            }
        } else if (choice === '4') {
            const target = (await promptQuestion(rl, 'Enter parameter number or exact name to DELETE: ')).trim();
            const keys = Object.keys(config);
            const idx = parseInt(target, 10) - 1;
            const keyToDelete = (idx >= 0 && idx < keys.length) ? keys[idx] : target;

            if (keyToDelete && keyToDelete in config) {
                const confirm = (await promptQuestion(rl, `Delete "${keyToDelete}"? [y/N]: `)).toLowerCase();
                if (confirm === 'y') {
                    delete config[keyToDelete];
                    isDirty = true;
                }
            } else {
                console.log('\x1b[31mInvalid parameter selection.\x1b[0m');
                await promptQuestion(rl, 'Press Enter to continue...');
            }
        } else if (choice === '5') {
            try {
                config = await editInSystemEditor(config);
                isDirty = true;
            } catch (err) {
                console.error('\x1b[31m[EDITOR ERROR]\x1b[0m', err.message);
                await promptQuestion(rl, 'Press Enter to continue...');
            }
        } else if (choice === 's') {
            try {
                saveEncryptedConfig(CONFIG_ENC_PATH, config);
                syncToEnvFile(config);
                console.log('\n\x1b[1m\x1b[32m✔ SUCCESS: Configuration successfully encrypted and saved to config.enc!\x1b[0m\n');
                isDirty = false;
                await promptQuestion(rl, 'Press Enter to return to menu...');
            } catch (err) {
                console.error('\x1b[31m[SAVE ERROR]\x1b[0m', err.message);
                await promptQuestion(rl, 'Press Enter to continue...');
            }
        } else if (choice === 'q') {
            if (isDirty) {
                const confirm = (await promptQuestion(rl, '\x1b[33mYou have unsaved changes. Exit without saving? [y/N]: \x1b[0m')).toLowerCase();
                if (confirm !== 'y') continue;
            }
            console.log('\x1b[36mExiting configuration tool.\x1b[0m');
            rl.close();
            process.exit(0);
        }
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal CLI Error:', err);
        process.exit(1);
    });
}

module.exports = { main };
