function requireAdmin(req) {
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return false;
  }
  return true;
}

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
  } catch {
    return false;
  }
}

const VALID_EXPERIENCES = ['0-1', '1-3', '3-5', '5-8', '8+'];
const VALID_STATUSES = ['pending', 'shortlisted', 'rejected'];

module.exports = { requireAdmin, sanitize, isValidEmail, isValidUrl, VALID_EXPERIENCES, VALID_STATUSES };
