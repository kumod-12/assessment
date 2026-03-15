const { MongoClient } = require('mongodb');

let cachedClient = null;

async function getDb() {
  if (cachedClient) return cachedClient.db('assessment');

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client.db('assessment');
}

module.exports = { getDb };
