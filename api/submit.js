const { getDb } = require('./lib/db');
const { sanitize, isValidEmail, isValidUrl, VALID_EXPERIENCES } = require('./lib/auth');
const { v4: uuidv4 } = require('uuid');

// Simple in-memory rate limiting per IP
const rateMap = new Map();

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // Rate limit: 5 per 15 min per IP
  const ip = req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const entry = rateMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > windowMs) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count++;
  rateMap.set(ip, entry);
  if (entry.count > 5) {
    return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
  }

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

    const wordLimit = 200;
    for (const [label, text] of [['Q1', q1], ['Q2', q2], ['Q3', q3]]) {
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      if (wordCount > wordLimit) {
        return res.status(400).json({ error: `${label} exceeds ${wordLimit} word limit.` });
      }
    }

    const db = await getDb();
    const collection = db.collection('responses');

    const duplicate = await collection.findOne({ email: { $regex: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } });
    if (duplicate) {
      return res.status(409).json({ error: 'A submission with this email already exists.' });
    }

    await collection.insertOne({
      id: uuidv4(),
      fullName,
      email,
      linkedin,
      experience,
      q1,
      q2,
      q3,
      submittedAt: new Date().toISOString(),
      status: 'pending',
    });

    res.status(200).json({ message: 'Assessment submitted successfully.' });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
