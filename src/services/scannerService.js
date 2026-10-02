// src/services/scannerService.js - Industrial COM Port Scanner Engine
const EventEmitter = require('events');
let SerialPort = null;
let ReadlineParser = null;

try {
    const sp = require('serialport');
    SerialPort = sp.SerialPort;
    const parserMod = require('@serialport/parser-readline');
    ReadlineParser = parserMod.ReadlineParser;
} catch (e) {
    console.warn('[SCANNER] serialport module not yet loaded');
}

class ScannerService extends EventEmitter {
    constructor() {
        super();
        this.port = null;
        this.parser = null;
        this.activePortPath = process.env.COM_PORT || 'COM3';
        this.baudRate = parseInt(process.env.COM_BAUD_RATE || '9600', 10);
        this.dataBits = parseInt(process.env.COM_DATA_BITS || '8', 10);
        this.stopBits = parseFloat(process.env.COM_STOP_BITS || '1');
        this.parity = process.env.COM_PARITY || 'none';
        const rawDelim = process.env.COM_DELIMITER || 'CRLF';
        if (rawDelim === 'CRLF' || rawDelim === '\\r\\n' || rawDelim === '\r\n') this.delimiter = '\r\n';
        else if (rawDelim === 'CR' || rawDelim === '\\r' || rawDelim === '\r') this.delimiter = '\r';
        else if (rawDelim === 'LF' || rawDelim === '\\n' || rawDelim === '\n') this.delimiter = '\n';
        else if (rawDelim === 'TAB' || rawDelim === '\\t' || rawDelim === '\t') this.delimiter = '\t';
        else this.delimiter = rawDelim;
        this.rtscts = process.env.COM_RTSCTS === 'true';
        this.isConnected = false;
        this.reconnectTimer = null;
        this.autoReconnect = true;
    }

    /**
     * List all available hardware COM / Serial ports on the Windows machine
     */
    async listAvailablePorts() {
        if (!SerialPort) return [];
        try {
            const ports = await SerialPort.list();
            return ports.map(p => ({
                path: p.path,
                manufacturer: p.manufacturer || 'Generic / Virtual COM',
                serialNumber: p.serialNumber || '',
                friendlyName: p.friendlyName || p.path
            }));
        } catch (err) {
            console.error('[SCANNER ERROR] Failed to list ports:', err.message);
            return [];
        }
    }

    /**
     * Connect to specified COM port with complete industrial parameters
     */
    connect(options = {}) {
        if (!SerialPort || !ReadlineParser) {
            console.warn('[SCANNER] Cannot connect: SerialPort module not available');
            this.isConnected = false;
            return Promise.resolve({ isConnected: false, error: 'SerialPort module not available' });
        }

        this.disconnect();

        // Support both connect(options) and legacy connect(portPath, baudRate)
        if (typeof options === 'string') {
            this.activePortPath = options;
            if (arguments.length > 1 && typeof arguments[1] === 'number') {
                this.baudRate = arguments[1];
            }
        } else if (typeof options === 'object') {
            if (options.port) this.activePortPath = options.port;
            if (options.baudRate) this.baudRate = parseInt(options.baudRate, 10);
            if (options.dataBits) this.dataBits = parseInt(options.dataBits, 10);
            if (options.stopBits) this.stopBits = parseFloat(options.stopBits);
            if (options.parity) this.parity = options.parity;
            if (options.delimiter) {
                // Decode escape sequences like \r\n
                let d = options.delimiter;
                if (d === '\\r\\n' || d === 'CRLF') d = '\r\n';
                else if (d === '\\r' || d === 'CR') d = '\r';
                else if (d === '\\n' || d === 'LF') d = '\n';
                else if (d === '\\t' || d === 'TAB') d = '\t';
                this.delimiter = d;
            }
            if (options.rtscts !== undefined) this.rtscts = !!options.rtscts;
        }

        return new Promise((resolve) => {
            try {
                console.log(`[SCANNER] Opening COM port ${this.activePortPath} [${this.baudRate}-${this.dataBits}-${this.parity.toUpperCase()[0]}-${this.stopBits}] Delimiter: ${JSON.stringify(this.delimiter)}...`);
                
                this.port = new SerialPort({
                    path: this.activePortPath,
                    baudRate: this.baudRate,
                    dataBits: this.dataBits,
                    stopBits: this.stopBits,
                    parity: this.parity,
                    rtscts: this.rtscts,
                    autoOpen: false
                });

                this.parser = this.port.pipe(new ReadlineParser({ delimiter: this.delimiter }));

                this.port.open((err) => {
                    if (err) {
                        this.isConnected = false;
                        console.warn(`[SCANNER WARNING] Could not open ${this.activePortPath}: ${err.message}`);
                        this.emit('status', { isConnected: false, port: this.activePortPath, error: err.message });
                        this.scheduleReconnect();
                        return resolve({ isConnected: false, error: err.message });
                    }
                    this.isConnected = true;
                    console.log(`[SCANNER] Successfully connected to ${this.activePortPath}`);
                    this.emit('status', {
                        isConnected: true,
                        port: this.activePortPath,
                        baudRate: this.baudRate,
                        dataBits: this.dataBits,
                        stopBits: this.stopBits,
                        parity: this.parity
                    });
                    return resolve({ isConnected: true, port: this.activePortPath });
                });

                this.parser.on('data', (line) => {
                    const scannedPayload = line.trim();
                    if (scannedPayload.length > 0) {
                        console.log(`[SCANNER DATA] Received: ${scannedPayload}`);
                        this.emit('scan', scannedPayload);
                    }
                });

                this.port.on('error', (err) => {
                    this.isConnected = false;
                    console.error(`[SCANNER PORT ERROR] ${err.message}`);
                    this.emit('error', err);
                    this.scheduleReconnect();
                });

                this.port.on('close', () => {
                    this.isConnected = false;
                    console.warn(`[SCANNER] Port ${this.activePortPath} closed`);
                    this.emit('status', { isConnected: false, port: this.activePortPath });
                    this.scheduleReconnect();
                });

            } catch (err) {
                this.isConnected = false;
                console.error(`[SCANNER EXCEPTION] ${err.message}`);
                this.scheduleReconnect();
                return resolve({ isConnected: false, error: err.message });
            }
        });
    }

    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.port) {
            try {
                this.port.removeAllListeners();
                if (this.port.isOpen) {
                    this.port.close();
                }
            } catch (e) {}
        }
        this.port = null;
        this.parser = null;
        this.isConnected = false;
    }

    scheduleReconnect() {
        if (!this.autoReconnect || this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.isConnected) {
                console.log(`[SCANNER] Attempting auto-reconnect to ${this.activePortPath}...`);
                this.connect();
            }
        }, 5000);
    }



    getStatus() {
        let delimKey = 'CRLF';
        let delimDisplay = 'CRLF (\\r\\n)';
        if (this.delimiter === '\r') { delimKey = 'CR'; delimDisplay = 'CR (\\r)'; }
        else if (this.delimiter === '\n') { delimKey = 'LF'; delimDisplay = 'LF (\\n)'; }
        else if (this.delimiter === '\t') { delimKey = 'TAB'; delimDisplay = 'TAB (\\t)'; }

        return {
            isConnected: this.isConnected,
            activePort: this.activePortPath,
            baudRate: this.baudRate,
            dataBits: this.dataBits,
            stopBits: this.stopBits,
            parity: this.parity,
            delimiter: delimKey,
            delimiterDisplay: delimDisplay,
            rtscts: this.rtscts
        };
    }
}

// Singleton scanner service
const scannerService = new ScannerService();

module.exports = scannerService;
