const { MongoClient } = require('mongodb');

let cachedClient = null;
let cachedDb = null;

async function getDb() {
  if (cachedDb) return cachedDb;

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  const client = new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 1,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });

  await client.connect();
  cachedClient = client;
  cachedDb = client.db('assessment');
  return cachedDb;
}

module.exports = { getDb };
