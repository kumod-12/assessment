const express = require('express');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
const PORT = 3001;
const DATA_FILE = path.join(__dirname, 'responses.json');

// ── Admin token (set via env or auto-generated) ──
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(32).toString('hex');

// ── Security headers ──
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
    },
  },
}));

// ── Request size limit (50KB) ──
app.use(express.json({ limit: '50kb' }));

// ── Rate limiting ──
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: 'Too many submissions. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60,
  message: { error: 'Too many requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Static files ──
app.use(express.static(path.join(__dirname, 'public')));

// ── Data helpers ──
function readResponses() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '[]');
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function writeResponses(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ── Input sanitization ──
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[<>]/g, '') // strip angle brackets
    .trim()
    .slice(0, 5000); // hard cap
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && url.length <= 500;
  } catch {
    return false;
  }
}

const VALID_EXPERIENCES = ['0-1', '1-3', '3-5', '5-8', '8+'];
const VALID_STATUSES = ['pending', 'shortlisted', 'rejected'];

// ── Auth middleware for admin routes ──
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized. Admin token required.' });
  }
  next();
}

// ── Submit assessment (public, rate-limited) ──
app.post('/api/submit', submitLimiter, (req, res) => {
  const fullName = sanitize(req.body.fullName);
  const email = sanitize(req.body.email);
  const linkedin = sanitize(req.body.linkedin);
  const experience = sanitize(req.body.experience);
  const q1 = sanitize(req.body.q1);
  const q2 = sanitize(req.body.q2);
  const q3 = sanitize(req.body.q3);

  // Validate required fields
  if (!fullName || !email || !linkedin || !experience || !q1 || !q2 || !q3) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  // Validate formats
  if (fullName.length > 200) {
    return res.status(400).json({ error: 'Name is too long.' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  if (!isValidUrl(linkedin)) {
    return res.status(400).json({ error: 'Invalid LinkedIn URL.' });
  }

  if (!VALID_EXPERIENCES.includes(experience)) {
    return res.status(400).json({ error: 'Invalid experience range.' });
  }

  // Word limit check (200 words)
  const wordLimit = 200;
  for (const [label, text] of [['Q1', q1], ['Q2', q2], ['Q3', q3]]) {
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount > wordLimit) {
      return res.status(400).json({ error: `${label} exceeds ${wordLimit} word limit.` });
    }
  }

  // Duplicate check
  const responses = readResponses();
  const duplicate = responses.find(r => r.email.toLowerCase() === email.toLowerCase());
  if (duplicate) {
    return res.status(409).json({ error: 'A submission with this email already exists.' });
  }

  const submission = {
    id: uuidv4(),
    fullName,
    email,
    linkedin,
    experience,
    q1,
    q2,
    q3,
    submittedAt: new Date().toISOString(),
    status: 'pending'
  };

  responses.push(submission);
  writeResponses(responses);

  res.json({ message: 'Assessment submitted successfully.' });
});

// ── Admin: Get all responses ──
app.get('/api/responses', requireAdmin, apiLimiter, (req, res) => {
  const responses = readResponses();
  res.json(responses);
});

// ── Admin: Update response status/notes ──
app.patch('/api/responses/:id', requireAdmin, apiLimiter, (req, res) => {
  const { status, notes } = req.body;
  const responses = readResponses();
  const index = responses.findIndex(r => r.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Response not found.' });
  }

  if (status) {
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Use: pending, shortlisted, rejected.' });
    }
    responses[index].status = status;
  }

  if (notes !== undefined) {
    responses[index].notes = sanitize(notes).slice(0, 1000);
  }

  responses[index].reviewedAt = new Date().toISOString();

  writeResponses(responses);
  res.json(responses[index]);
});

// ── Admin: Delete a response ──
app.delete('/api/responses/:id', requireAdmin, apiLimiter, (req, res) => {
  let responses = readResponses();
  const before = responses.length;
  responses = responses.filter(r => r.id !== req.params.id);

  if (responses.length === before) {
    return res.status(404).json({ error: 'Response not found.' });
  }

  writeResponses(responses);
  res.json({ message: 'Response deleted.' });
});

// ── Error handler (hide stack traces) ──
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request too large.' });
  }
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`\nNDTV Assessment server running at http://localhost:${PORT}`);
  console.log(`Assessment form:    http://localhost:${PORT}`);
  console.log(`Review dashboard:   http://localhost:${PORT}/review.html`);
  console.log(`\nAdmin token: ${ADMIN_TOKEN}`);
  console.log(`Set ADMIN_TOKEN env var to use a fixed token.\n`);
});
