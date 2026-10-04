#!/usr/bin/env node
/**
 * scripts/com-scanner-emulator.js
 * 
 * Hardware & Software Barcode / QR Scanner Simulator for RecordKeeper Dispatch System.
 * 
 * Provides instantaneous, zero-driver barcode scan simulation:
 * - Connects to the application's live WebSocket broadcast channel (ws://localhost:4000)
 * - Optionally binds to a physical/virtual COM port if available (--port COMx)
 * - Auto-syncs with active MongoDB dispatch session (press [SPACE] to scan next FIFO box)
 * - Continuous auto-scan burst mode (press [a] to auto-scan entire order with realistic delay)
 * - Manual input: type or paste any barcode string and press [ENTER]
 */

const path = require('path');
const readline = require('readline');
const WebSocket = require('ws');
const mongoose = require('mongoose');

// Initialize encrypted config environment
try {
    const { initEnvironment } = require('../src/utils/cryptoConfig');
    initEnvironment();
} catch (e) {
    require('dotenv').config({ path: path.join(__dirname, '../.env') });
}

let SerialPort = null;
try {
    const sp = require('serialport');
    SerialPort = sp.SerialPort;
} catch (e) {}

// MongoDB models for intelligent active-session target discovery
let DispatchTransaction = null;
let DispatchBox = null;
let isMongoConnected = false;

try {
    const models = require('../src/models');
    DispatchTransaction = models.DispatchTransaction;
    DispatchBox = models.DispatchBox;
} catch (e) {}

// Command line arguments
const args = process.argv.slice(2);
function getArg(flag, fallback) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1]) return args[idx + 1];
    return fallback;
}

const SERVER_PORT = process.env.PORT || 4000;
const defaultWsUrl = `ws://127.0.0.1:${SERVER_PORT}?role=scanner`;
const WS_URL = getArg('--ws', defaultWsUrl);
const SERIAL_PORT = getArg('--port', null);
const BAUD_RATE = parseInt(getArg('--baud', process.env.COM_BAUD_RATE || '9600'), 10);

// ANSI Colors
const C = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m'
};

let wsClient = null;
let serialConnection = null;
let rl = null;
let isAutoScanning = false;
let activeChannel = 'none';

async function connectDb() {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/plc_sticker';
    try {
        await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 2000 });
        isMongoConnected = true;
    } catch (err) {
        isMongoConnected = false;
    }
}

// Connect to Application WebSocket
function connectWebSocket() {
    return new Promise((resolve) => {
        try {
            wsClient = new WebSocket(WS_URL, {
                headers: { 'x-client-role': 'scanner' }
            });

            wsClient.on('open', () => {
                activeChannel = 'WebSocket Bridge';
                console.log(`${C.green}✔ CONNECTED to Application at ${WS_URL}!${C.reset}`);
                resolve(true);
            });

            wsClient.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === 'SCANNER_DATA') {
                        // Received confirmation of scan processed by app
                    }
                } catch (e) {}
            });

            wsClient.on('error', (err) => {
                if (activeChannel !== 'WebSocket Bridge') {
                    console.log(`${C.yellow}⚠ Could not connect to WebSocket at ${WS_URL}: ${err.message}${C.reset}`);
                }
                resolve(false);
            });

            wsClient.on('close', () => {
                if (activeChannel === 'WebSocket Bridge') {
                    console.log(`\n${C.yellow}⚠ WebSocket disconnected from ${WS_URL}. Reconnecting in 3s...${C.reset}`);
                    setTimeout(connectWebSocket, 3000);
                }
            });
        } catch (err) {
            resolve(false);
        }
    });
}

// Optionally Connect to Physical COM Port if specified
function tryConnectSerial(portName) {
    if (!SerialPort || !portName) return Promise.resolve(false);

    return new Promise((resolve) => {
        try {
            serialConnection = new SerialPort({
                path: portName,
                baudRate: BAUD_RATE,
                autoOpen: true
            });

            serialConnection.on('open', () => {
                activeChannel = `Serial Port (${portName})`;
                console.log(`${C.green}✔ CONNECTED to Hardware Serial Port ${portName}!${C.reset}`);
                resolve(true);
            });

            serialConnection.on('error', (err) => {
                console.log(`${C.yellow}ℹ Hardware serial port ${portName} unavailable: ${err.message}${C.reset}`);
                resolve(false);
            });
        } catch (e) {
            resolve(false);
        }
    });
}

// Transmit Barcode Payload to Application
function transmitBarcode(payload) {
    const trimmed = (payload || '').trim();
    if (!trimmed) return false;

    const now = new Date().toLocaleTimeString();
    let sent = false;

    // 1. Send via WebSocket bridge
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
        wsClient.send(JSON.stringify({
            type: 'SIMULATE_SCAN',
            payload: { qrData: trimmed }
        }));
        sent = true;
    }

    // 2. Also send via Serial Port if open
    if (serialConnection && serialConnection.isOpen) {
        serialConnection.write(trimmed + '\r\n');
        sent = true;
    }

    if (sent) {
        console.log(`\n${C.green}✔ [SCAN TRANSMITTED]${C.reset} ${C.dim}${now}${C.reset}`);
        console.log(`  ${C.bright}QR Payload :${C.reset} ${C.cyan}${trimmed}${C.reset}`);
        console.log(`  ${C.dim}Channel    :${C.reset} ${activeChannel}`);
    } else {
        console.log(`\n${C.red}✖ [TRANSMIT FAILED] No active connection to dispatch server!${C.reset}`);
        console.log(`  Ensure your main app is running: npm run dev`);
    }

    promptUser();
    return sent;
}

// Fetch Next FIFO Target from Active Dispatch Session
async function getActiveDispatchNextTarget() {
    if (!isMongoConnected || !DispatchTransaction || !DispatchBox) return null;

    try {
        const activeTx = await DispatchTransaction.findOne({ status: 'in_progress' }).lean();
        if (!activeTx) return { status: 'no_active' };

        const scannedBoxIds = (activeTx.scannedBoxes || []).map(s => s.boxId.toString());
        const pendingBox = (activeTx.allocatedBoxes || []).find(b => !scannedBoxIds.includes(b.boxId.toString()));

        if (!pendingBox) {
            return {
                status: 'complete',
                dispatchId: activeTx.dispatchId,
                total: activeTx.allocatedBoxes.length
            };
        }

        let payload = pendingBox.batchQrData;
        if (!payload && pendingBox.boxId) {
            const boxDoc = await DispatchBox.findById(pendingBox.boxId).lean();
            if (boxDoc && boxDoc.batchQrData) payload = boxDoc.batchQrData;
        }
        if (!payload) payload = `BOX-${pendingBox.batchNumber}`;

        return {
            status: 'pending',
            dispatchId: activeTx.dispatchId,
            boxId: pendingBox.boxId,
            batchNumber: pendingBox.batchNumber,
            completedCount: pendingBox.completedCount,
            qrData: payload,
            scannedCount: scannedBoxIds.length,
            totalCount: activeTx.allocatedBoxes.length
        };
    } catch (e) {
        return null;
    }
}

// Auto-Scan Routine: Scans all pending boxes in active session one by one
async function runAutoScan() {
    if (isAutoScanning) return;
    isAutoScanning = true;

    console.log(`\n${C.yellow}⚡ STARTING CONTINUOUS AUTO-SCAN FOR ACTIVE DISPATCH...${C.reset}`);

    let lastScannedBoxId = null;
    let retries = 0;

    while (isAutoScanning) {
        const target = await getActiveDispatchNextTarget();
        if (!target || target.status === 'no_active') {
            console.log(`${C.yellow}ℹ No active dispatch session found. Start a dispatch in the browser.${C.reset}`);
            break;
        }

        if (target.status === 'complete') {
            console.log(`\n${C.green}🎉 ALL ${target.total} BOXES IN DISPATCH ${target.dispatchId} HAVE BEEN SCANNED!${C.reset}`);
            break;
        }

        if (target.boxId === lastScannedBoxId) {
            retries++;
            if (retries > 2) {
                console.log(`${C.yellow}⚠ Box #${target.batchNumber} was not verified by server. Waiting 2s before retry...${C.reset}`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        } else {
            retries = 0;
            lastScannedBoxId = target.boxId;
        }

        console.log(`\n${C.cyan}▶ Auto-Scanning Box #${target.batchNumber} (${target.scannedCount + 1}/${target.totalCount}): ${C.bright}${target.qrData}${C.reset}`);
        transmitBarcode(target.qrData);

        // Realistic pause between conveyor scans (1.5 seconds)
        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    isAutoScanning = false;
    promptUser();
}

function promptUser() {
    if (isAutoScanning) return;
    process.stdout.write(`\n${C.bright}${C.cyan}SCANNER > ${C.reset}`);
}

async function printHeader() {
    console.clear();
    console.log(`${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
    console.log(`${C.cyan}║${C.reset}  ${C.bright}RECORDKEEPER INDUSTRIAL SCANNER SIMULATOR${C.reset}                                ${C.cyan}║${C.reset}`);
    console.log(`${C.cyan}║${C.reset}  ${C.dim}Direct real-time scan injection into Dispatch Cockpit & Optical Gate${C.reset}      ${C.cyan}║${C.reset}`);
    console.log(`${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}`);

    console.log(`\n${C.bright}TRANSMISSION CHANNEL:${C.reset}`);
    console.log(`  • Channel Mode   : ${C.green}${activeChannel}${C.reset}`);
    console.log(`  • Target Server  : ${C.bright}${WS_URL}${C.reset}`);
    console.log(`  • Database Sync  : ${isMongoConnected ? C.green + 'ONLINE (FIFO Auto-Target Ready)' + C.reset : C.dim + 'OFFLINE (Manual Mode)' + C.reset}`);

    console.log(`\n${C.bright}KEYBOARD SHORTCUTS:${C.reset}`);
    console.log(`  ${C.cyan}[SPACE] / [n]${C.reset}  Auto-scan NEXT FIFO box from active dispatch session`);
    console.log(`  ${C.cyan}[a]${C.reset}            Run continuous AUTO-SCAN for entire active order`);
    console.log(`  ${C.cyan}[s]${C.reset}            Stop continuous auto-scan`);
    console.log(`  ${C.cyan}[Enter text]${C.reset}   Type or paste any custom barcode/QR string and press [ENTER]`);
    console.log(`  ${C.cyan}[t]${C.reset}            Send sample test barcode payload`);
    console.log(`  ${C.cyan}[q] / [Ctrl+C]${C.reset} Exit simulator`);
    console.log(`${C.dim}─────────────────────────────────────────────────────────────────────────────${C.reset}`);
}

async function main() {
    await connectDb();

    // If user explicitly passed a serial port, try it first
    if (SERIAL_PORT) {
        await tryConnectSerial(SERIAL_PORT);
    }

    // Connect to WebSocket bridge
    await connectWebSocket();

    await printHeader();
    promptUser();

    rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true
    });

    rl.on('line', async (line) => {
        const input = line.trim();

        if (input.toLowerCase() === 'q' || input.toLowerCase() === 'exit') {
            console.log('\nExiting scanner simulator. Goodbye.');
            if (wsClient) wsClient.close();
            if (serialConnection && serialConnection.isOpen) serialConnection.close();
            process.exit(0);
        }

        if (input.toLowerCase() === 's') {
            if (isAutoScanning) {
                isAutoScanning = false;
                console.log(`${C.yellow}Auto-scan stopped.${C.reset}`);
            }
            promptUser();
            return;
        }

        if (input.toLowerCase() === 'a') {
            runAutoScan();
            return;
        }

        if (input === '' || input.toLowerCase() === 'n') {
            const target = await getActiveDispatchNextTarget();
            if (!target || target.status === 'no_active') {
                console.log(`${C.yellow}ℹ No active dispatch session found. Start a dispatch in the browser or type a manual payload.${C.reset}`);
                promptUser();
                return;
            }

            if (target.status === 'complete') {
                console.log(`${C.green}✔ Active dispatch ${target.dispatchId} is already 100% scanned!${C.reset}`);
                promptUser();
                return;
            }

            console.log(`${C.cyan}⚡ Scanning FIFO Target: Box #${target.batchNumber} (${target.scannedCount + 1}/${target.totalCount})...${C.reset}`);
            transmitBarcode(target.qrData);
            return;
        }

        if (input.toLowerCase() === 't') {
            const sample = `TEST-BOX-${Math.floor(1000 + Math.random() * 9000)}`;
            console.log(`${C.cyan}⚡ Transmitting test barcode payload...${C.reset}`);
            transmitBarcode(sample);
            return;
        }

        transmitBarcode(input);
    });

    rl.on('SIGINT', () => {
        console.log('\n\nDisconnecting scanner simulator. Goodbye.');
        if (wsClient) wsClient.close();
        if (serialConnection && serialConnection.isOpen) serialConnection.close();
        process.exit(0);
    });
}

main().catch(err => {
    console.error('Fatal scanner simulator error:', err);
    process.exit(1);
});
