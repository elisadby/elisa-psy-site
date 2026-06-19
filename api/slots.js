// api/slots.js — Sync Google Agenda puis retourne les créneaux disponibles

import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

async function syncFromGoogleCalendar() {
  const { google } = await import('googleapis');
  
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://elisadebussy.fr/api/auth/callback'
  );

  let refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  try {
    const stored = await redis.get('google:refresh_token');
    if (stored) refreshToken = stored;
  } catch(e) {}

  auth.setCredentials({ refresh_token: refreshToken });
  auth.on('tokens', async (tokens) => {
    if (tokens.refresh_token) {
      await redis.set('google:refresh_token', tokens.refresh_token);
    }
  });

  const calendar = google.calendar({ version: 'v3', auth });
  const now      = new Date();
  const maxDate  = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: maxDate.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    q: 'Disponible'
  });

  const events = response.data.items || [];
  const activeGcalEventIds = new Set(events.map(e => e.id));

  // Supprimer les créneaux dont l'événement a été supprimé
  const allKeys = await redis.keys('slot:slot_gcal_*');
  for (const key of allKeys) {
    const slot = await redis.get(key);
    if (!slot) continue;
    if (!slot.booked && slot.gcalEventId && !activeGcalEventIds.has(slot.gcalEventId)) {
      await redis.del(key);
    }
    if (slot && !slot.booked && new Date(slot.datetime) < now) {
      await redis.del(key);
    }
  }

  // Créer les nouveaux créneaux
  for (const event of events) {
    const title     = event.summary || '';
    const isCabinet = title.toUpperCase().includes('[CABINET]');
    const isVisio   = title.toUpperCase().includes('[VISIO]');
    if (!isCabinet && !isVisio) continue;

    const type      = isCabinet ? 'cabinet' : 'visio';
    const eventId   = event.id;
    const startTime = new Date(event.start.dateTime || event.start.date);
    const endTime   = new Date(event.end.dateTime   || event.end.date);

    let slotStart = new Date(startTime);
    while (slotStart < endTime) {
      const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);
      if (slotEnd > endTime) break;

      const slotId   = `slot_gcal_${eventId}_${slotStart.getTime()}`;
      const existing = await redis.get(`slot:${slotId}`);

      if (!existing) {
        await redis.set(`slot:${slotId}`, {
          id: slotId,
          datetime: slotStart.toISOString(),
          type,
          booked: false,
          gcalEventId: eventId,
          createdAt: new Date().toISOString()
        });
      }

      slotStart = slotEnd;
    }
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    // Sync synchrone — attend la fin avant de retourner les créneaux
    try {
      await syncFromGoogleCalendar();
    } catch(e) {
      console.error('SYNC ERROR:', e.message);
      // On continue même si la sync échoue — on retourne ce qu'on a
    }

    const keys = await redis.keys('slot:*');
    if (!keys.length) return res.json([]);

    const slots = await Promise.all(keys.map(k => redis.get(k)));
    const valid  = slots.filter(Boolean);

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
