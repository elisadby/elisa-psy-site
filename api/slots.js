// api/slots.js — Gestion des créneaux (Upstash Redis)
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — liste des créneaux
  if (req.method === 'GET') {
    const keys = await redis.keys('slot:*');
    if (!keys.length) return res.json([]);

    const slots = await Promise.all(keys.map(k => redis.get(k)));
    const valid  = slots.filter(Boolean);

    if (req.query.all && req.query.token) {
      return res.json(valid);
    }

    const now       = new Date();
    const available = valid.filter(s => !s.booked && new Date(s.datetime) > now);
    return res.json(available);
  }

  // POST — créer un créneau
  if (req.method === 'POST') {
    const { datetime, type, token } = req.body;
    if (!datetime || !type) return res.status(400).json({ error: 'datetime et type requis' });

    const id   = `slot_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    const slot = { id, datetime, type, booked: false, createdAt: new Date().toISOString() };
    await redis.set(`slot:${id}`, slot);
    return res.status(201).json(slot);
  }

  res.status(405).json({ error: 'Method not allowed' });
}
