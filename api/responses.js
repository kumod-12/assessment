const { MongoClient } = require('mongodb');

// ── DB connection (cached across warm invocations) ──
let cachedDb = null;

async function getDb() {
  if (cachedDb) return cachedDb;
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
  const client = new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 1,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });
  await client.connect();
  cachedDb = client.db('assessment');
  return cachedDb;
}

// ── Helpers ──
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, 5000);
}

const VALID_STATUSES = ['pending', 'shortlisted', 'rejected'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized. Admin token required.' });
  }

  try {
    const db = await getDb();
    const collection = db.collection('responses');

    if (req.method === 'GET') {
      const responses = await collection.find({}).sort({ submittedAt: -1 }).toArray();
      return res.status(200).json(responses);
    }

    if (req.method === 'PATCH') {
      const { id, status, notes } = req.body;
      if (!id) return res.status(400).json({ error: 'ID is required.' });

      const update = { reviewedAt: new Date().toISOString() };
      if (status) {
        if (!VALID_STATUSES.includes(status)) {
          return res.status(400).json({ error: 'Invalid status.' });
        }
        update.status = status;
      }
      if (notes !== undefined) update.notes = sanitize(notes).slice(0, 1000);

      const result = await collection.findOneAndUpdate(
        { id },
        { $set: update },
        { returnDocument: 'after' }
      );
      if (!result) return res.status(404).json({ error: 'Response not found.' });
      return res.status(200).json(result);
    }

    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'ID is required.' });
      const result = await collection.deleteOne({ id });
      if (result.deletedCount === 0) return res.status(404).json({ error: 'Response not found.' });
      return res.status(200).json({ message: 'Response deleted.' });
    }

    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error('Responses error:', err.message, err.stack);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};
