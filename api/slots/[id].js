// api/slots/[id].js — Supprimer un créneau (Upstash Redis)
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'DELETE') {
    const { id } = req.query;
    await redis.del(`slot:${id}`);
    return res.json({ deleted: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
