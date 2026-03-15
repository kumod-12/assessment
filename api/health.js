module.exports = async function handler(req, res) {
  const hasMongoUri = !!process.env.MONGODB_URI;
  const hasAdminToken = !!process.env.ADMIN_TOKEN;
  const nodeVersion = process.version;

  let dbStatus = 'not tested';
  if (hasMongoUri) {
    try {
      const { MongoClient } = require('mongodb');
      const client = new MongoClient(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });
      await client.connect();
      await client.db('assessment').command({ ping: 1 });
      await client.close();
      dbStatus = 'connected';
    } catch (err) {
      dbStatus = 'failed: ' + err.message;
    }
  }

  res.status(200).json({
    status: 'ok',
    nodeVersion,
    envVars: {
      MONGODB_URI: hasMongoUri ? 'set' : 'MISSING',
      ADMIN_TOKEN: hasAdminToken ? 'set' : 'MISSING',
    },
    dbStatus,
  });
};
