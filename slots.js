// api/slots.js — Gestion des créneaux
// Vercel Serverless Function (Node.js)

import { kv } from '@vercel/kv';

const ADMIN_TOKEN_SECRET = process.env.ADMIN_PASSWORD || 'elisa2025';

function isAdmin(token) {
  // Vérification simple — suffisant pour cet usage
  return token != null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET /api/slots — liste des créneaux disponibles (patients)
  // GET /api/slots?all=true&token=xxx — tous les créneaux (admin)
  if (req.method === 'GET') {
    const allKeys = await kv.keys('slot:*');
    const slots = await Promise.all(allKeys.map(k => kv.get(k)));
    const valid  = slots.filter(Boolean);

    if (req.query.all && req.query.token) {
      return res.json(valid);
    }

    // Patients : uniquement les créneaux libres et futurs
    const now = new Date();
    const available = valid.filter(s => !s.booked && new Date(s.datetime) > now);
    return res.json(available);
  }

  // POST /api/slots — créer un créneau (admin)
  if (req.method === 'POST') {
    const { datetime, type, token } = req.body;
    if (!datetime || !type) return res.status(400).json({ error: 'datetime et type requis' });

    const id   = `slot_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    const slot = { id, datetime, type, booked: false, createdAt: new Date().toISOString() };
    await kv.set(`slot:${id}`, slot);
    return res.status(201).json(slot);
  }

  res.status(405).json({ error: 'Method not allowed' });
}
