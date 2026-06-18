// api/bookings.js — Liste des réservations (admin)
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const keys     = await redis.keys('booking:*');
    if (!keys.length) return res.json([]);
    const bookings = await Promise.all(keys.map(k => redis.get(k)));
    return res.json(bookings.filter(Boolean).sort((a,b) => new Date(a.datetime) - new Date(b.datetime)));
  }

  res.status(405).json({ error: 'Method not allowed' });
}
