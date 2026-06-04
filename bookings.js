// api/bookings.js — Liste des réservations (admin)
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const allKeys  = await kv.keys('booking:*');
    const bookings = await Promise.all(allKeys.map(k => kv.get(k)));
    return res.json(bookings.filter(Boolean));
  }
  res.status(405).json({ error: 'Method not allowed' });
}
