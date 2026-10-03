const mongoose = require('mongoose');
const { initEnvironment } = require('../src/utils/cryptoConfig');
initEnvironment();
const { connectDB } = require('../src/config/db');

async function run() {
  const conn = await connectDB();
  const db = conn.db;

  const totalBatches = await db.collection('batches').countDocuments();
  const uniqueBatchIds = (await db.collection('batches').distinct('_id')).length;
  const totalBoxes = await db.collection('dispatch_boxes').countDocuments();
  const uniqueBoxBatchIds = (await db.collection('dispatch_boxes').distinct('batchId')).length;
  const uniqueBoxQrs = (await db.collection('dispatch_boxes').distinct('batchQrData')).length;

  console.log('--- COUNTS ---');
  console.log({ totalBatches, uniqueBatchIds, totalBoxes, uniqueBoxBatchIds, uniqueBoxQrs });

  // Check duplicate batchNumbers in batches
  const dupBatchNums = await db.collection('batches').aggregate([
    { $group: { _id: '$batchNumber', count: { $sum: 1 }, models: { $addToSet: '$modelId' } } },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();
  console.log('Duplicate batchNumber in batches count:', dupBatchNums.length);
  if (dupBatchNums.length > 0) {
    console.log('Sample duplicate batchNumbers:', dupBatchNums.slice(0, 5));
  }

  // Check duplicate batchQrData in batches
  const dupBatchQrs = await db.collection('batches').aggregate([
    { $group: { _id: '$batchQrData', count: { $sum: 1 }, batchNumbers: { $addToSet: '$batchNumber' } } },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();
  console.log('Duplicate batchQrData in batches count:', dupBatchQrs.length);

  // Check duplicate batchId in dispatch_boxes
  const dupDispatchBatchIds = await db.collection('dispatch_boxes').aggregate([
    { $group: { _id: '$batchId', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();
  console.log('Duplicate batchId in dispatch_boxes count:', dupDispatchBatchIds.length);

  // Check duplicate batchQrData in dispatch_boxes
  const dupDispatchQrs = await db.collection('dispatch_boxes').aggregate([
    { $group: { _id: '$batchQrData', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();
  console.log('Duplicate batchQrData in dispatch_boxes count:', dupDispatchQrs.length);

  // Check transactions
  const txStatuses = await db.collection('dispatch_transactions').aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]).toArray();
  console.log('Transaction statuses:', txStatuses);

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
