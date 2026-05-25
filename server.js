'use strict';
const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT     = __dirname;
const DATA_DIR = path.join(ROOT, 'data');

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Only serve these safe web file types — everything else is blocked
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.xml': 'application/xml', '.txt': 'text/plain',
};

// ── Load .env ─────────────────────────────────────────────────────────────────
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const eq = line.indexOf('=');
    if (eq > 0 && !line.trim().startsWith('#')) {
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (key) process.env[key] = val;
    }
  });
}

const GROQ_API_KEY      = process.env.GROQ_API_KEY      || '';
let   ADMIN_PASSWORD    = process.env.ADMIN_PASSWORD    || '';
const PORT              = parseInt(process.env.PORT, 10) || 3000;
const SESSION_TTL_MS    = 24 * 60 * 60 * 1000; // 24 hours
const MAX_BODY_BYTES    = 512 * 1024;           // 512 KB
const LOGIN_MAX_TRIES   = 5;
const LOGIN_LOCKOUT_MS  = 15 * 60 * 1000;       // 15 minutes
const SUBMIT_RATE_MS    = 60 * 1000;            // 1 submission per minute per IP
const CHAT_RATE_MS      = 10 * 1000;            // 1 chat message per 10s per IP
const submitTimes       = new Map();            // IP → last submit timestamp
const chatTimes         = new Map();            // IP → last chat timestamp

// ── Nodemailer ────────────────────────────────────────────────────────────────
let transporter = null;
try {
  const nodemailer = require('nodemailer');
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    console.log('✓ Email transport configured');
  }
} catch (e) {}

// ── Sessions: token → expiry timestamp ───────────────────────────────────────
const SESSIONS     = new Map();   // token -> expiresAt
const SESSION_FILE = path.join(DATA_DIR, 'sessions.json');

function loadSessions() {
  try {
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    const now = Date.now();
    raw.forEach(([t, exp]) => { if (exp > now) SESSIONS.set(t, exp); });
  } catch (e) {}
}
function saveSessions() {
  const now = Date.now();
  // Prune expired before saving
  for (const [t, exp] of SESSIONS) { if (exp <= now) SESSIONS.delete(t); }
  fs.writeFileSync(SESSION_FILE, JSON.stringify([...SESSIONS.entries()]), 'utf8');
}
function createSession() {
  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  SESSIONS.set(token, expiresAt);
  saveSessions();
  return token;
}
function authCheck(req) {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  const exp = SESSIONS.get(token);
  if (!exp) return false;
  if (Date.now() > exp) { SESSIONS.delete(token); return false; }
  return true;
}

loadSessions();

// ── Brute-force protection (per IP) ──────────────────────────────────────────
const loginAttempts = new Map(); // ip -> { count, lockUntil }

function isLockedOut(ip) {
  const rec = loginAttempts.get(ip);
  if (!rec) return false;
  if (rec.lockUntil && Date.now() < rec.lockUntil) return true;
  if (rec.lockUntil && Date.now() >= rec.lockUntil) { loginAttempts.delete(ip); return false; }
  return false;
}
function recordFailedLogin(ip) {
  const rec = loginAttempts.get(ip) || { count: 0, lockUntil: null };
  rec.count++;
  if (rec.count >= LOGIN_MAX_TRIES) rec.lockUntil = Date.now() + LOGIN_LOCKOUT_MS;
  loginAttempts.set(ip, rec);
}
function clearLoginAttempts(ip) { loginAttempts.delete(ip); }

// ── Input sanitization ────────────────────────────────────────────────────────
function sanitizeString(val, maxLen = 500) {
  if (typeof val !== 'string') return String(val ?? '').slice(0, maxLen);
  // Strip null bytes and control characters (except newlines/tabs)
  return val.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, maxLen).trim();
}

function sanitizeFormData(data) {
  const out = {};
  const FIELD_MAX = { message: 2000, note: 1000 };
  for (const [k, v] of Object.entries(data)) {
    const key = sanitizeString(k, 60);
    const max = FIELD_MAX[key] || 300;
    out[key]  = sanitizeString(v, max);
  }
  return out;
}

// ── Rooms DB ──────────────────────────────────────────────────────────────────
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
function readRooms() {
  try { return JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8')); } catch { return []; }
}
function writeRooms(data) {
  fs.writeFileSync(ROOMS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── Content DB ────────────────────────────────────────────────────────────────
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
function readContent() {
  try { return JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8')); } catch { return {}; }
}
function writeContent(data) {
  fs.writeFileSync(CONTENT_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── Submissions DB ────────────────────────────────────────────────────────────
const SUBS_FILE = path.join(DATA_DIR, 'submissions.json');
function readSubmissions() {
  try { return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); } catch { return []; }
}
function writeSubmissions(data) {
  fs.writeFileSync(SUBS_FILE, JSON.stringify(data, null, 2), 'utf8');
}
function saveSubmission(raw) {
  const subs  = readSubmissions();
  const clean = sanitizeFormData(raw);
  const entry = {
    id:        Date.now().toString(36) + crypto.randomBytes(4).toString('hex'),
    timestamp: new Date().toISOString(),
    status:    'new',
    ...clean,
  };
  subs.unshift(entry);
  writeSubmissions(subs);
  return entry;
}

// ── Aria AI system prompt ─────────────────────────────────────────────────────
const ARIA_SYSTEM = `You are Aria, the AI concierge for Firnic Group — a premium hospitality brand in Accra, Ghana.

Services:
1. FIRNIC HOTEL — Luxury hotel, Ofankor Hills Estate, Accra
   Rooms: Standard GHS 450/night | Deluxe GHS 550/night | Junior Suite GHS 700/night | Executive Suite GHS 950/night
   Amenities: Pool, spa, restaurant, free WiFi, airport transfer, 24h concierge
   Book: WhatsApp +233 592 997 811 | hotel@firnicgroup.com

2. FIRNIC EXECUTIVE CARS — Premium chauffeur & self-drive car hire
   Self-drive: 1 day GHS 1,500 | 3 days GHS 4,200 | 1 week GHS 9,500
   Book: sales@firnicgroup.com | +233 592 997 811

3. FIRNIC PRESTIGE MASSAGE STUDIO
   Deep Tissue: GHS 280/380/480 (60/90/120 min)
   Thai Oil: GHS 260/360/460 | Swedish: GHS 250/350/450
   Book: WhatsApp +233 592 997 811

4. FIRNIC EVENTS — Weddings, corporate, private (up to 500 guests)
   Enquire: events@firnicgroup.com | +233 592 997 811

5. FIRNIC TRANSPORT HUB — Ride hailing & delivery in Accra

CONTACT: +233 592 997 811 | info@firnicgroup.com | 14 Ofankor Hills Estate, Accra

Rules: Be warm and concise. Give specific prices when asked. Direct to WhatsApp for bookings. Keep replies under 120 words unless listing. Never fabricate information.`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        return reject(new Error('Request body too large'));
      }
      body += chunk;
    });
    req.on('end', () => {
      // Only parse if Content-Type is JSON
      const ct = req.headers['content-type'] || '';
      if (!ct.includes('application/json')) return resolve({});
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function getClientIP(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

function callGroq(messages) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: ARIA_SYSTEM },
        ...messages
      ],
      max_tokens: 512,
      temperature: 0.7
    });

    const opts = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const r = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const p = JSON.parse(d);
          const text = p.choices?.[0]?.message?.content;
          if (text) resolve(text);
          else {
            console.error('[Groq] Error response:', d.slice(0, 500));
            const code = p.error?.code || '';
            const errMsg = p.error?.message || 'No response from Groq';
            reject(new Error(code === 'rate_limit_exceeded' ? '429 ' + errMsg : errMsg));
          }
        } catch (e) { console.error('[Groq] Parse error:', d.slice(0, 500)); reject(e); }
      });
    });
    r.on('error', reject);
    r.write(payload);
    r.end();
  });
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    let busboy;
    try { busboy = require('busboy'); } catch { return reject(new Error('busboy not installed')); }
    const fields = {};
    const attachments = [];
    let fileCount = 0;
    const MAX_FILES = 8;
    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: 5 * 1024 * 1024, files: MAX_FILES, fieldNameSize: 100, fieldSize: 10000 }
    });
    bb.on('field', (name, val) => {
      const k = sanitizeString(name, 60);
      if (k) fields[k] = sanitizeString(val, 500);
    });
    bb.on('file', (name, stream, info) => {
      if (++fileCount > MAX_FILES) { stream.resume(); return; }
      const { filename, mimeType } = info;
      const chunks = [];
      stream.on('data', d => chunks.push(d));
      stream.on('end', () => {
        if (chunks.length) {
          attachments.push({
            filename: path.basename(filename || name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100),
            content: Buffer.concat(chunks),
            contentType: mimeType
          });
        }
      });
      stream.on('error', () => {});
    });
    bb.on('close', () => resolve({ fields, attachments }));
    bb.on('error', reject);
    req.pipe(bb);
  });
}

async function sendFormEmail(entry) {
  if (!transporter) return false;
  const labels = {
    hotel:'🏨 Hotel Booking', car:'🚗 Car Booking', ride:'🚕 Ride Order',
    delivery:'📦 Delivery Order', event:'🎉 Event Enquiry',
    massage:'💆 Massage Booking', contact:'📬 Contact Message',
    driver:'🧑‍✈️ Driver Application'
  };
  const subject = (labels[entry._type] || '📋 Form Submission') + ' — Firnic Group';
  const rows = Object.entries(entry)
    .filter(([k]) => !k.startsWith('_') && !['id','status','updatedAt'].includes(k))
    .map(([k, v]) => {
      const safeK = k.replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const safeV = String(v).replace(/</g,'&lt;').replace(/>/g,'&gt;');
      return `<tr><td style="padding:6px 12px;font-weight:600;background:#f5f5f5;border:1px solid #ddd;white-space:nowrap">${safeK}</td><td style="padding:6px 12px;border:1px solid #ddd">${safeV}</td></tr>`;
    }).join('');
  await transporter.sendMail({
    from: `"Firnic Website" <${process.env.SMTP_USER}>`,
    to:   process.env.NOTIFY_EMAIL || 'info@firnicgroup.com',
    subject,
    html: `<div style="font-family:sans-serif;max-width:600px">
      <div style="background:#0e0e0e;padding:20px 24px"><h2 style="color:#c9a84c;margin:0;font-size:1.1rem">Firnic Group — New Submission</h2></div>
      <table style="width:100%;border-collapse:collapse;margin-top:16px">${rows}</table>
      <p style="margin-top:20px"><a href="${process.env.RENDER_EXTERNAL_URL || 'http://localhost:'+PORT}/admin/" style="background:#c9a84c;color:#0e0e0e;padding:10px 20px;text-decoration:none;border-radius:4px;font-weight:700">View in Admin Panel →</a></p>
      <p style="color:#888;font-size:0.8rem;margin-top:16px">Received ${new Date(entry.timestamp).toLocaleString('en-GH',{timeZone:'Africa/Accra'})}</p>
    </div>`
  });
  return true;
}

async function sendUserConfirmation(entry) {
  if (!transporter || !entry.email || !entry.email.includes('@')) return false;
  const name = entry.name || 'there';
  const messages = {
    hotel:   { label: 'hotel reservation',        eta: 'within the hour' },
    car:     { label: 'car rental request',        eta: 'within the hour' },
    massage: { label: 'massage appointment',       eta: 'within 24 hours' },
    event:   { label: 'event enquiry',             eta: 'within 24 hours' },
    driver:  { label: 'driver application',        eta: 'within 24 hours' },
    contact: { label: 'message',                   eta: 'shortly' },
  };
  const { label, eta } = messages[entry._type] || { label: 'enquiry', eta: 'shortly' };
  await transporter.sendMail({
    from: `"Firnic Group" <${process.env.SMTP_USER}>`,
    to:   entry.email,
    subject: `We received your ${label} — Firnic Group`,
    html: `<div style="font-family:sans-serif;max-width:560px;color:#333">
      <div style="background:#080808;padding:24px 28px">
        <h2 style="color:#c9a84c;margin:0;font-size:1.1rem;letter-spacing:1px">FIRNIC GROUP</h2>
      </div>
      <div style="padding:28px 28px 20px">
        <h3 style="margin:0 0 12px;font-size:1.1rem;color:#111">Hi ${name.replace(/</g,'&lt;').replace(/>/g,'&gt;')},</h3>
        <p style="margin:0 0 16px;line-height:1.7;color:#444">
          Thank you for reaching out. We have received your <strong>${label}</strong> and our team will get back to you <strong>${eta}</strong>.
        </p>
        <p style="margin:0 0 24px;line-height:1.7;color:#444">
          In the meantime, feel free to reach us directly on WhatsApp or by phone if you need immediate assistance.
        </p>
        <a href="https://wa.me/233592997811" style="display:inline-block;background:#c9a84c;color:#080808;padding:12px 24px;text-decoration:none;font-weight:700;font-size:0.9rem;letter-spacing:0.5px">
          Chat on WhatsApp →
        </a>
      </div>
      <div style="background:#f5f5f5;padding:16px 28px;font-size:0.78rem;color:#888">
        Firnic Group · +233 592 997 811 · info@firnicgroup.com · 14 Ofankor Hills Estate, Accra
      </div>
    </div>`
  });
  return true;
}

// ── Allowed origins for CORS ──────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  'null', // file:// protocol
  'https://firnicgroup.com',
  'https://www.firnicgroup.com',
  // Render / production URL — auto-detected
  ...(process.env.RENDER_EXTERNAL_URL ? [process.env.RENDER_EXTERNAL_URL] : []),
]);

function setCORS(req, res) {
  const origin = req.headers['origin'] || 'null';
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Vary', 'Origin');
}

// ── HTTP Server ───────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  let urlPath;
  try {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    urlPath = decodeURIComponent(urlObj.pathname);
  } catch {
    res.writeHead(400); res.end('Bad request'); return;
  }

  setCORS(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── Security headers ────────────────────────────────────────────────────────
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://images.unsplash.com blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join('; '));

  // ── GET /api/content ── public, used by pages to load dynamic prices ────────
  if (urlPath === '/api/content' && req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    json(res, 200, readContent());
    return;
  }

  // ── POST /api/chat ──────────────────────────────────────────────────────────
  if (urlPath === '/api/chat' && req.method === 'POST') {
    if (!GROQ_API_KEY) return json(res, 503, { error: 'AI not configured' });
    const chatIp = getClientIP(req);
    const lastChat = chatTimes.get(chatIp) || 0;
    if (Date.now() - lastChat < CHAT_RATE_MS) {
      return json(res, 429, { error: 'Too many messages. Please wait a moment.' });
    }
    chatTimes.set(chatIp, Date.now());
    if (chatTimes.size > 5000) {
      const cutoff = Date.now() - CHAT_RATE_MS * 2;
      for (const [k, v] of chatTimes) { if (v < cutoff) chatTimes.delete(k); }
    }
    try {
      const { messages } = await parseBody(req);
      if (!Array.isArray(messages) || messages.length > 40) return json(res, 400, { error: 'Invalid messages' });
      // Sanitize user messages
      const safe = messages.map(m => ({
        role:    m.role === 'assistant' ? 'assistant' : 'user',
        content: sanitizeString(String(m.content || ''), 1000)
      }));
      const reply = await callGroq(safe);
      json(res, 200, { reply });
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('429') || msg.toLowerCase().includes('quota')) {
        json(res, 503, { error: 'AI not configured' }); // triggers friendly fallback in widget
      } else {
        json(res, 500, { error: 'Chat error' });
      }
    }
    return;
  }

  // ── GET /api/availability ───────────────────────────────────────────────────
  if (urlPath === '/api/availability' && req.method === 'GET') {
    const rooms = readRooms().map(r => ({
      id: r.id, name: r.name, price: r.price,
      available: r.available, total: r.total,
      status: r.available === 0 ? 'booked' : r.available <= 1 ? 'limited' : 'available'
    }));
    res.setHeader('Cache-Control', 'no-store');
    json(res, 200, rooms);
    return;
  }

  // ── POST /api/submit ────────────────────────────────────────────────────────
  if (urlPath === '/api/submit' && req.method === 'POST') {
    const ip = getClientIP(req);
    const last = submitTimes.get(ip) || 0;
    if (Date.now() - last < SUBMIT_RATE_MS) {
      return json(res, 429, { ok: false, error: 'Please wait before submitting again.' });
    }
    submitTimes.set(ip, Date.now());
    // Clean up old entries to prevent memory leak
    if (submitTimes.size > 5000) {
      const cutoff = Date.now() - SUBMIT_RATE_MS * 2;
      for (const [k, v] of submitTimes) { if (v < cutoff) submitTimes.delete(k); }
    }
    try {
      const body  = await parseBody(req);
      const entry = saveSubmission(body);
      let emailed = false;
      try { emailed = await sendFormEmail(entry); } catch {}
      try { await sendUserConfirmation(entry); } catch {}
      json(res, 200, { ok: true, id: entry.id, emailed });
    } catch (e) { json(res, 500, { ok: false, error: 'Submission failed' }); }
    return;
  }

  // ── POST /api/driver-apply — multipart with file attachments ───────────────
  if (urlPath === '/api/driver-apply' && req.method === 'POST') {
    const ip = getClientIP(req);
    const last = submitTimes.get(ip) || 0;
    if (Date.now() - last < SUBMIT_RATE_MS) {
      return json(res, 429, { ok: false, error: 'Please wait before submitting again.' });
    }
    submitTimes.set(ip, Date.now());
    if (submitTimes.size > 5000) {
      const cutoff = Date.now() - SUBMIT_RATE_MS * 2;
      for (const [k, v] of submitTimes) { if (v < cutoff) submitTimes.delete(k); }
    }
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('multipart/form-data')) {
      return json(res, 400, { ok: false, error: 'Expected multipart/form-data' });
    }
    try {
      const { fields, attachments } = await parseMultipart(req);
      const entry = saveSubmission(fields);
      let emailed = false;
      let filesNote = false;
      if (transporter) {
        const rows = Object.entries(entry)
          .filter(([k]) => !k.startsWith('_') && !['id','status','updatedAt','agree'].includes(k))
          .map(([k, v]) => {
            const sk = k.replace(/</g,'&lt;').replace(/>/g,'&gt;');
            const sv = String(v).replace(/</g,'&lt;').replace(/>/g,'&gt;');
            return `<tr><td style="padding:6px 12px;font-weight:600;background:#f5f5f5;border:1px solid #ddd;white-space:nowrap">${sk}</td><td style="padding:6px 12px;border:1px solid #ddd">${sv}</td></tr>`;
          }).join('');
        await transporter.sendMail({
          from: `"Firnic Website" <${process.env.SMTP_USER}>`,
          to:   process.env.NOTIFY_EMAIL || 'info@firnicgroup.com',
          subject: '🧑‍✈️ Driver Application — Firnic Group',
          html: `<div style="font-family:sans-serif;max-width:600px">
            <div style="background:#0e0e0e;padding:20px 24px"><h2 style="color:#c9a84c;margin:0;font-size:1.1rem">Firnic Group — Driver Application</h2></div>
            <table style="width:100%;border-collapse:collapse;margin-top:16px">${rows}</table>
            <p style="margin-top:16px;color:#555;font-size:0.85rem">${attachments.length} document(s) attached.</p>
            <p style="margin-top:8px"><a href="${process.env.RENDER_EXTERNAL_URL||'http://localhost:'+PORT}/admin/" style="background:#c9a84c;color:#0e0e0e;padding:10px 20px;text-decoration:none;border-radius:4px;font-weight:700">View in Admin →</a></p>
          </div>`,
          attachments
        });
        try { await sendUserConfirmation(entry); } catch {}
        emailed = true;
      } else {
        filesNote = true;
      }
      json(res, 200, { ok: true, id: entry.id, emailed, filesNote });
    } catch (e) {
      console.error('[driver-apply]', e.message);
      json(res, 500, { ok: false, error: 'Submission failed' });
    }
    return;
  }

  // ══ ADMIN ROUTES ════════════════════════════════════════════════════════════

  // POST /admin/login ── rate-limited
  if (urlPath === '/admin/login' && req.method === 'POST') {
    if (!ADMIN_PASSWORD) return json(res, 503, { ok: false, error: 'Admin not configured. Set ADMIN_PASSWORD environment variable.' });
    const ip = getClientIP(req);
    if (isLockedOut(ip)) {
      return json(res, 429, { ok: false, error: 'Too many attempts. Try again in 15 minutes.' });
    }
    const { password } = await parseBody(req);
    if (typeof password !== 'string' || password !== ADMIN_PASSWORD) {
      recordFailedLogin(ip);
      const rec = loginAttempts.get(ip);
      const left = Math.max(0, LOGIN_MAX_TRIES - (rec?.count || 0));
      return json(res, 401, { ok: false, error: `Wrong password. ${left} attempts remaining.` });
    }
    clearLoginAttempts(ip);
    json(res, 200, { ok: true, token: createSession() });
    return;
  }

  // POST /admin/logout
  if (urlPath === '/admin/logout' && req.method === 'POST') {
    const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
    SESSIONS.delete(token);
    saveSessions();
    json(res, 200, { ok: true });
    return;
  }

  // All /admin/api/* routes require auth
  if (urlPath.startsWith('/admin/api/')) {
    if (!authCheck(req)) return json(res, 401, { error: 'Unauthorised or session expired' });

    // GET /admin/api/submissions
    if (urlPath === '/admin/api/submissions' && req.method === 'GET') {
      json(res, 200, readSubmissions()); return;
    }

    // PATCH /admin/api/submissions/:id
    if (/^\/admin\/api\/submissions\/[a-z0-9]+$/.test(urlPath) && req.method === 'PATCH') {
      const id   = urlPath.split('/').pop();
      const body = await parseBody(req);
      const subs = readSubmissions();
      const idx  = subs.findIndex(s => s.id === id);
      if (idx === -1) return json(res, 404, { error: 'Not found' });
      const VALID_STATUS = new Set(['new','handled','called','confirmed','cancelled']);
      if (body.status && VALID_STATUS.has(body.status)) subs[idx].status = body.status;
      if (body.note !== undefined) subs[idx].note = sanitizeString(String(body.note), 1000);
      subs[idx].updatedAt = new Date().toISOString();
      writeSubmissions(subs);
      json(res, 200, subs[idx]); return;
    }

    // DELETE /admin/api/submissions/:id
    if (/^\/admin\/api\/submissions\/[a-z0-9]+$/.test(urlPath) && req.method === 'DELETE') {
      const id   = urlPath.split('/').pop();
      writeSubmissions(readSubmissions().filter(s => s.id !== id));
      json(res, 200, { ok: true }); return;
    }

    // GET /admin/api/rooms
    if (urlPath === '/admin/api/rooms' && req.method === 'GET') {
      json(res, 200, readRooms()); return;
    }

    // PATCH /admin/api/rooms/:id
    if (/^\/admin\/api\/rooms\/[\w-]+$/.test(urlPath) && req.method === 'PATCH') {
      const id    = urlPath.split('/').pop();
      const body  = await parseBody(req);
      const rooms = readRooms();
      const idx   = rooms.findIndex(r => r.id === id);
      if (idx === -1) return json(res, 404, { error: 'Room not found' });
      if (typeof body.delta === 'number') {
        rooms[idx].available = Math.max(0, Math.min(rooms[idx].total, rooms[idx].available + Math.round(body.delta)));
      } else if (typeof body.available === 'number') {
        rooms[idx].available = Math.max(0, Math.min(rooms[idx].total, Math.round(body.available)));
      }
      if (typeof body.total === 'number' && body.total >= 0) {
        rooms[idx].total     = Math.round(body.total);
        rooms[idx].available = Math.min(rooms[idx].available, rooms[idx].total);
      }
      if (typeof body.price === 'number' && body.price > 0) rooms[idx].price = Math.round(body.price);
      if (typeof body.name === 'string' && body.name.trim()) rooms[idx].name = sanitizeString(body.name.trim(), 100);
      if (typeof body.description === 'string') rooms[idx].description = sanitizeString(body.description, 500);
      writeRooms(rooms);
      json(res, 200, rooms[idx]); return;
    }

    // GET /admin/api/content
    if (urlPath === '/admin/api/content' && req.method === 'GET') {
      json(res, 200, readContent()); return;
    }

    // PATCH /admin/api/content
    if (urlPath === '/admin/api/content' && req.method === 'PATCH') {
      const body = await parseBody(req);
      const current = readContent();
      const updated = { ...current };
      for (const [section, vals] of Object.entries(body)) {
        if (vals && typeof vals === 'object' && !Array.isArray(vals)) {
          const sanitized = {};
          for (const [k, v] of Object.entries(vals)) {
            const key = sanitizeString(k, 60);
            sanitized[key] = typeof v === 'number' ? Math.max(0, Math.round(v)) : sanitizeString(String(v), 300);
          }
          updated[section] = { ...(current[section] || {}), ...sanitized };
        }
      }
      writeContent(updated);
      json(res, 200, { ok: true, content: updated }); return;
    }

    // POST /admin/api/bookings  ── manual booking by admin (no rate-limit)
    if (urlPath === '/admin/api/bookings' && req.method === 'POST') {
      try {
        const body  = await parseBody(req);
        const entry = saveSubmission({ ...body, _manual: 'true' });
        json(res, 200, { ok: true, id: entry.id });
      } catch (e) { json(res, 500, { ok: false, error: 'Failed to save booking' }); }
      return;
    }

    // POST /admin/api/change-password
    if (urlPath === '/admin/api/change-password' && req.method === 'POST') {
      const body = await parseBody(req);
      const { currentPassword, newPassword } = body;
      if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
        return json(res, 400, { ok: false, error: 'Invalid request' });
      }
      if (currentPassword !== ADMIN_PASSWORD) {
        return json(res, 401, { ok: false, error: 'Incorrect current password' });
      }
      if (newPassword.length < 8) {
        return json(res, 400, { ok: false, error: 'Password must be at least 8 characters' });
      }
      // Update .env file
      try {
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
        if (/^ADMIN_PASSWORD\s*=/m.test(envContent)) {
          envContent = envContent.replace(/^ADMIN_PASSWORD\s*=.*$/m, `ADMIN_PASSWORD=${newPassword}`);
        } else {
          envContent += `\nADMIN_PASSWORD=${newPassword}\n`;
        }
        fs.writeFileSync(envPath, envContent, 'utf8');
        // Update in-memory variable
        process.env.ADMIN_PASSWORD = newPassword;
        ADMIN_PASSWORD = newPassword;
        // Invalidate all sessions so new password is required
        SESSIONS.clear();
        saveSessions();
        json(res, 200, { ok: true });
      } catch (e) {
        json(res, 500, { ok: false, error: 'Could not save new password' });
      }
      return;
    }

    // GET /admin/api/stats
    if (urlPath === '/admin/api/stats' && req.method === 'GET') {
      const subs  = readSubmissions();
      const today = new Date().toDateString();
      json(res, 200, {
        total:   subs.length,
        new:     subs.filter(s => s.status === 'new').length,
        handled: subs.filter(s => s.status === 'handled').length,
        today:   subs.filter(s => new Date(s.timestamp).toDateString() === today).length,
        byType:  subs.reduce((acc, s) => { const t = s._type || 'other'; acc[t] = (acc[t]||0)+1; return acc; }, {}),
      }); return;
    }

    return json(res, 404, { error: 'Not found' });
  }

  // ── Static file serving (with path-traversal protection) ───────────────────
  // Strip leading slash first (before normalize) so '/' → '' → ROOT on Windows
  const stripped = urlPath.replace(/^\/+/, '');
  const safePath = path.normalize(stripped || '.').replace(/^(\.\.(\/|\\|$))+/, '');
  let   filePath = path.resolve(ROOT, safePath);

  // Reject if resolved path escapes root
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  // Serve index.html for directories
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  // Only serve files within allowed extensions
  const ext = path.extname(filePath).toLowerCase();
  if (ext && !MIME[ext]) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  // Block serving sensitive files even if inside ROOT
  const BLOCKED = new Set(['.env', '.env.example', 'sessions.json', 'package.json', 'package-lock.json', 'server.js']);
  if (BLOCKED.has(path.basename(filePath)) || filePath.includes(path.join(ROOT, 'data')) || filePath.includes(path.join(ROOT, 'node_modules'))) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><head><title>404</title>
        <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:sans-serif;background:#0e0e0e;color:#c9a84c;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:1rem}a{color:#c9a84c;opacity:.7}a:hover{opacity:1}</style>
        </head><body><h1 style="font-size:5rem;font-weight:800">404</h1><p style="color:#555">This page doesn't exist</p><a href="/">← Back to Firnic Hotel</a></body></html>`);
      return;
    }
    // Cache-Control: HTML = no-cache; assets (JS/CSS/images/fonts) = 1 day
    const isAsset = ['.js','.css','.jpg','.jpeg','.png','.webp','.avif','.gif','.svg','.ico','.woff','.woff2','.ttf'].includes(ext);
    res.setHeader('Cache-Control', isAsset ? 'public, max-age=86400, stale-while-revalidate=3600' : 'no-cache');
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });

}).listen(PORT, () => {
  console.log(`\n✓ Firnic website  → http://localhost:${PORT}`);
  console.log(`✓ Admin panel     → http://localhost:${PORT}/admin/`);
  console.log(`✓ AI chat (Groq)  → ${GROQ_API_KEY ? 'enabled' : 'disabled (add GROQ_API_KEY to .env)'}`);
  console.log(`✓ Email           → ${transporter ? 'enabled' : 'disabled (add SMTP_USER + SMTP_PASS to .env)'}\n`);
});
