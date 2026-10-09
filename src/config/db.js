// src/config/db.js - High-Reliability Database Connection Manager
const mongoose = require('mongoose');

let isConnected = false;
let lastDbError = null;
let configuredUri = null;

async function connectDB(customUri = null) {
    const mongoUri = customUri || process.env.MONGO_URI || 'mongodb://localhost:27017/dispatch_db';
    configuredUri = mongoUri;

    try {
        if (customUri && mongoose.connection.readyState !== 0) {
            console.log('[DATABASE] Disconnecting existing connection before reconnecting...');
            await mongoose.disconnect();
        } else if (mongoose.connection.readyState === 1) {
            isConnected = true;
            lastDbError = null;
            return mongoose.connection;
        }

        mongoose.set('strictQuery', false);
        mongoose.set('bufferCommands', false);

        console.log(`[DATABASE] Attempting connection to: ${mongoUri.replace(/:([^:@]+)@/, ':****@')}...`);
        const conn = await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 3000,
            socketTimeoutMS: 45000
        });

        isConnected = true;
        lastDbError = null;
        console.log(`[DATABASE] Connected successfully to: ${conn.connection.host}/${conn.connection.name}`);
        return conn.connection;
    } catch (error) {
        isConnected = false;
        lastDbError = error.message;
        console.error(`[DATABASE ERROR] Could not connect to MongoDB: ${error.message}`);
        throw error;
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

        const dbName = tempConn.name || 'unnamed';
        await tempConn.close();

        return {
            success: true,
            databaseName: dbName,
            collections: colNames,
            message: `Connected successfully to database "${dbName}"! (${colNames.length} collections detected)`
        };
    } catch (err) {
        return {
            success: false,
            message: `Connection failed: ${err.message}`
        };
    }
}

function getStatus() {
    const ready = mongoose.connection.readyState === 1;
    return {
        isConnected: ready,
        readyState: mongoose.connection.readyState,
        host: ready ? mongoose.connection.host : null,
        port: ready ? (mongoose.connection.port || 27017) : null,
        name: ready ? mongoose.connection.name : null,
        isConfigured: !!(configuredUri || process.env.MONGO_URI),
        lastError: lastDbError
    };
}

module.exports = {
    connectDB,
    testConnection,
    getStatus
};
