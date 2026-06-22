// api/admin/auth.js — Authentification backoffice
// POST /api/admin/auth  { password }  → pose un cookie de session signé
// DELETE /api/admin/auth              → efface le cookie (logout)

import crypto from 'crypto';

function sign(value, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(value);
  return `${value}.${hmac.digest('hex')}`;
}

function verify(signed, secret) {
  const lastDot = signed.lastIndexOf('.');
  if (lastDot === -1) return null;
  const value = signed.slice(0, lastDot);
  const expected = sign(value, secret);
  if (!crypto.timingSafeEqual(Buffer.from(signed), Buffer.from(expected))) return null;
  return value;
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'same-origin');

  const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'change-me-in-vercel';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD non configuré' });
  }

  // Logout
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', 'admin_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
    return res.status(200).json({ success: true });
  }

  // Login
  if (req.method === 'POST') {
    const { password } = req.body || {};
    if (!password || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Mot de passe incorrect' });
    }
    const sessionValue = sign(`admin:${Date.now()}`, SESSION_SECRET);
    res.setHeader('Set-Cookie',
      `admin_session=${sessionValue}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`
    );
    return res.status(200).json({ success: true });
  }

  // Vérification de session (GET)
  if (req.method === 'GET') {
    const cookie = req.cookies?.admin_session || '';
    const verified = verify(cookie, SESSION_SECRET);
    if (!verified) return res.status(401).json({ authenticated: false });
    return res.status(200).json({ authenticated: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
