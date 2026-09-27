// src/config/db.js - High-Reliability Database Connection Manager
const mongoose = require('mongoose');
const dummyDataSeeder = require('../utils/dummyDataSeeder');

let isConnected = false;
let memoryServer = null;
let lastDbError = null;
let configuredUri = null;

/**
 * Seed realistic development data if using in-memory database
 */
async function seedDevData(conn, force = false) {
    try {
        const db = conn.db || (conn.connection && conn.connection.db) || mongoose.connection.db;
        if (!db) {
            console.warn('[DEV SEED] Database handle not available yet.');
            return;
        }
        await dummyDataSeeder.seedAll(db, { force });
    } catch (err) {
        console.warn(`[DEV SEED WARNING] Could not seed dev data: ${err.message}`);
    }
}

async function connectDB(customUri = null) {
    const mongoUri = customUri || process.env.MONGO_URI || 'mongodb://localhost:27017/plc_sticker';
    configuredUri = mongoUri;
    
    try {
        if (mongoose.connection.readyState === 1) {
            isConnected = true;
            lastDbError = null;
            return mongoose.connection;
        }

        mongoose.set('strictQuery', false);
        
        console.log(`[DATABASE] Attempting connection to: ${mongoUri}...`);
        const conn = await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 2000,
            socketTimeoutMS: 45000
        });

        isConnected = true;
        lastDbError = null;
        console.log(`[DATABASE] Connected successfully to: ${conn.connection.host}/${conn.connection.name}`);
        return conn.connection;
    } catch (error) {
        isConnected = false;
        lastDbError = error.message;
        const isProduction = process.env.NODE_ENV === 'production';

        if (isProduction) {
            console.error(`\n[DATABASE ERROR] Production MongoDB unreachable at: ${mongoUri}`);
            console.error(`[DATABASE ERROR] Error: ${error.message}`);
            console.warn('[DATABASE WARNING] Embedded in-memory database fallback is strictly disabled in production.');
            console.warn('[DATABASE WARNING] Starting server in safe mode. Reconfigure database parameters via UI System Settings.');
            throw error;
        }

        console.warn(`\n[DATABASE NOTICE] Could not connect to local/configured MongoDB (${mongoUri}): ${error.message}`);
        console.log('[DATABASE] Starting embedded in-memory database (mongodb-memory-server) for development...');
        
        try {
            const { MongoMemoryServer } = require('mongodb-memory-server');
            if (!memoryServer) {
                memoryServer = await MongoMemoryServer.create();
            }
            const inMemoryUri = memoryServer.getUri();
            console.log(`[DATABASE] Embedded MongoDB active at: ${inMemoryUri}`);

            const conn = await mongoose.connect(inMemoryUri);
            isConnected = true;
            lastDbError = null;

            // Seed rich demo models, batches, boxes, and historical transactions
            await seedDevData(conn.connection, false);

            return conn.connection;
        } catch (memErr) {
            isConnected = false;
            lastDbError = memErr.message;
            console.error(`[DATABASE ERROR] Failed to initialize embedded MongoDB: ${memErr.message}`);
            throw memErr;
        }
    }
}

async function testConnection(testUri) {
    try {
        const tempConn = await mongoose.createConnection(testUri, {
            serverSelectionTimeoutMS: 4000
        }).asPromise();

        // Check collections
        const collections = await tempConn.db.listCollections().toArray();
        const colNames = collections.map(c => c.name);

        let modelCount = 0;
        let batchCount = 0;
        let closedBatchCount = 0;

        if (colNames.includes('productmodels')) {
            modelCount = await tempConn.collection('productmodels').countDocuments();
        }
        if (colNames.includes('batches')) {
            batchCount = await tempConn.collection('batches').countDocuments();
            closedBatchCount = await tempConn.collection('batches').countDocuments({ status: 'closed' });
        }

        await tempConn.close();

        return {
            success: true,
            databaseName: tempConn.name,
            collections: colNames,
            modelCount,
            batchCount,
            closedBatchCount,
            message: `Connected successfully! Found ${modelCount} product models and ${closedBatchCount} closed batches ready for dispatch.`
        };
    } catch (err) {
        return {
            success: false,
            message: `Connection failed: ${err.message}`
        };
    }
}

function getStatus() {
    return {
        isConnected: mongoose.connection.readyState === 1,
        readyState: mongoose.connection.readyState,
        host: mongoose.connection.host || (memoryServer ? 'in-memory-embedded' : null),
        name: mongoose.connection.name || null,
        isEmbedded: !!memoryServer,
        configuredUri: configuredUri || process.env.MONGO_URI || null,
        lastError: lastDbError,
        isProduction: process.env.NODE_ENV === 'production'
    };
}

module.exports = {
    connectDB,
    testConnection,
    getStatus,
    seedDevData
};
