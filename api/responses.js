const { getDb } = require('./lib/db');
const { requireAdmin, sanitize, VALID_STATUSES } = require('./lib/auth');

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!requireAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized. Admin token required.' });
  }

  const db = await getDb();
  const collection = db.collection('responses');

  try {
    // GET — list all responses
    if (req.method === 'GET') {
      const responses = await collection.find({}).sort({ submittedAt: -1 }).toArray();
      return res.status(200).json(responses);
    }

    // PATCH — update status/notes
    if (req.method === 'PATCH') {
      const { id, status, notes } = req.body;

      if (!id) return res.status(400).json({ error: 'ID is required.' });

      const update = { reviewedAt: new Date().toISOString() };

      if (status) {
        if (!VALID_STATUSES.includes(status)) {
          return res.status(400).json({ error: 'Invalid status. Use: pending, shortlisted, rejected.' });
        }
        update.status = status;
      }

      if (notes !== undefined) {
        update.notes = sanitize(notes).slice(0, 1000);
      }

      const result = await collection.findOneAndUpdate(
        { id },
        { $set: update },
        { returnDocument: 'after' }
      );

      if (!result) return res.status(404).json({ error: 'Response not found.' });
      return res.status(200).json(result);
    }

    // DELETE — remove a response
    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'ID is required.' });

      const result = await collection.deleteOne({ id });
      if (result.deletedCount === 0) return res.status(404).json({ error: 'Response not found.' });
      return res.status(200).json({ message: 'Response deleted.' });
    }

    res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error('Responses error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
