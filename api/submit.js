const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && url.length <= 500;
  } catch { return false; }
}

const VALID_EXPERIENCES = ['0-1', '1-3', '3-5', '5-8', '8+'];

// ── Rate limit (in-memory, per cold start) ──
const rateMap = new Map();

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  // Rate limit
  const ip = req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  const entry = rateMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > 900000) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateMap.set(ip, entry);
  if (entry.count > 5) return res.status(429).json({ error: 'Too many submissions. Try again later.' });

  try {
    const fullName = sanitize(req.body.fullName);
    const email = sanitize(req.body.email);
    const linkedin = sanitize(req.body.linkedin);
    const experience = sanitize(req.body.experience);
    const q1 = sanitize(req.body.q1);
    const q2 = sanitize(req.body.q2);
    const q3 = sanitize(req.body.q3);

    if (!fullName || !email || !linkedin || !experience || !q1 || !q2 || !q3) {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    if (fullName.length > 200) return res.status(400).json({ error: 'Name is too long.' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email address.' });
    if (!isValidUrl(linkedin)) return res.status(400).json({ error: 'Invalid LinkedIn URL.' });
    if (!VALID_EXPERIENCES.includes(experience)) return res.status(400).json({ error: 'Invalid experience range.' });

    for (const [label, text] of [['Q1', q1], ['Q2', q2], ['Q3', q3]]) {
      if (text.split(/\s+/).filter(Boolean).length > 200) {
        return res.status(400).json({ error: `${label} exceeds 200 word limit.` });
      }
    }

    const db = await getDb();
    const collection = db.collection('responses');

    const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const duplicate = await collection.findOne({ email: { $regex: new RegExp(`^${escapedEmail}$`, 'i') } });
    if (duplicate) return res.status(409).json({ error: 'A submission with this email already exists.' });

    await collection.insertOne({
      id: uuidv4(),
      fullName, email, linkedin, experience, q1, q2, q3,
      submittedAt: new Date().toISOString(),
      status: 'pending',
    });

    return res.status(200).json({ message: 'Assessment submitted successfully.' });
  } catch (err) {
    console.error('Submit error:', err.message, err.stack);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};
