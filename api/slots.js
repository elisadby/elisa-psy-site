// api/slots.js — Liste les créneaux disponibles (synchronisés depuis Google Agenda)

import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    // Déclencher une sync silencieuse en arrière-plan
    try {
      fetch(`https://elisadebussy.fr/api/sync`, {
        method: 'GET'
      }).catch(() => {}); // Fire and forget
    } catch(e) {}

    const keys = await redis.keys('slot:*');
    if (!keys.length) return res.json([]);

    const slots = await Promise.all(keys.map(k => redis.get(k)));
    const valid = slots.filter(Boolean);

    if (req.query.all && req.query.token) {
      return res.json(valid.sort((a,b) => new Date(a.datetime) - new Date(b.datetime)));
    }

    const now       = new Date();
    const available = valid
      .filter(s => !s.booked && new Date(s.datetime) > now)
      .sort((a,b) => new Date(a.datetime) - new Date(b.datetime));

    return res.json(available);
  }

  res.status(405).json({ error: 'Method not allowed' });
}
