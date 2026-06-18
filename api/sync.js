// api/sync.js — Lit Google Agenda et synchronise les créneaux dans Upstash
// Les événements [CABINET] ou [VISIO] sont découpés en tranches d'1h

import { Redis } from '@upstash/redis';
import { google } from 'googleapis';

const redis = Redis.fromEnv();

async function getAuthClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://elisa-psy-site.vercel.app/api/auth/callback'
  );

  // Récupérer le refresh token stocké dans Redis (mis à jour par /api/auth/callback)
  let refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  try {
    const stored = await redis.get('google:refresh_token');
    if (stored) refreshToken = stored;
  } catch(e) {}

  auth.setCredentials({ refresh_token: refreshToken });

  // Sauvegarder le nouveau access token si rafraîchi
  auth.on('tokens', async (tokens) => {
    if (tokens.refresh_token) {
      await redis.set('google:refresh_token', tokens.refresh_token);
    }
  });

  return auth;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const auth     = await getAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });

    // Lire les événements des 60 prochains jours
    const now     = new Date();
    const maxDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: maxDate.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      q: 'Disponible' // Ne récupère que les événements contenant "Disponible"
    });

    const events = response.data.items || [];
    let slotsCreated = 0;

    for (const event of events) {
      const title = event.summary || '';
      const isCabinet = title.toUpperCase().includes('[CABINET]');
      const isVisio   = title.toUpperCase().includes('[VISIO]');
      if (!isCabinet && !isVisio) continue;

      const type      = isCabinet ? 'cabinet' : 'visio';
      const eventId   = event.id;
      const startTime = new Date(event.start.dateTime || event.start.date);
      const endTime   = new Date(event.end.dateTime   || event.end.date);

      // Découper en créneaux d'1h
      let slotStart = new Date(startTime);
      while (slotStart < endTime) {
        const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);
        if (slotEnd > endTime) break;

        const slotId  = `slot_gcal_${eventId}_${slotStart.getTime()}`;
        const existing = await redis.get(`slot:${slotId}`);

        // Ne pas écraser un créneau déjà réservé
        if (!existing || !existing.booked) {
          await redis.set(`slot:${slotId}`, {
            id: slotId,
            datetime: slotStart.toISOString(),
            type,
            booked: false,
            gcalEventId: eventId,
            createdAt: new Date().toISOString()
          });
          slotsCreated++;
        }

        slotStart = slotEnd;
      }
    }

    // Nettoyer les anciens créneaux libres dépassés
    const allKeys = await redis.keys('slot:slot_gcal_*');
    for (const key of allKeys) {
      const slot = await redis.get(key);
      if (slot && !slot.booked && new Date(slot.datetime) < now) {
        await redis.del(key);
      }
    }

    return res.json({ success: true, slotsCreated, eventsFound: events.length });

  } catch(e) {
    console.error('SYNC ERROR:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
