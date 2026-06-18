// api/book.js — Réservation + Google Calendar + emails via Brevo

import { Redis } from '@upstash/redis';
import { google } from 'googleapis';

const redis = Redis.fromEnv();

async function getAuthClient() {
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
  return auth;
}

async function sendBrevoEmail({ to, toName, subject, html }) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: { name: 'Elisa de Bussy', email: process.env.PRAT_EMAIL },
      to: [{ email: to, name: toName }],
      subject,
      htmlContent: html
    })
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Brevo error: ${err}`);
  }
  return response.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { slotId, prenom, nom, email, tel, message } = req.body;
  if (!slotId || !prenom || !nom || !email || !tel) {
    return res.status(400).json({ error: 'Champs obligatoires manquants' });
  }

  const slot = await redis.get(`slot:${slotId}`);
  if (!slot)       return res.status(404).json({ error: 'Créneau introuvable' });
  if (slot.booked) return res.status(409).json({ error: 'Créneau déjà réservé' });

  await redis.set(`slot:${slotId}`, { ...slot, booked: true, patient: { prenom, nom, email, tel, message } });

  const bookingId = `booking_${Date.now()}`;
  await redis.set(`booking:${bookingId}`, {
    id: bookingId, slotId,
    datetime: slot.datetime, type: slot.type,
    gcalEventId: slot.gcalEventId || null,
    prenom, nom, email, tel, message,
    createdAt: new Date().toISOString(), reminderSent: false
  });

  const startDt   = new Date(slot.datetime);
  const endDt     = new Date(startDt.getTime() + 60 * 60 * 1000);
  const dateStr   = startDt.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'Europe/Paris' });
  const timeStr   = startDt.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Paris' });
  const typeLabel = slot.type === 'cabinet' ? 'Au cabinet — 25bis avenue du Bédat, 33700 Mérignac' : 'Téléconsultation (visio)';
  const typeCourt = slot.type === 'cabinet' ? 'Cabinet · Mérignac' : 'Visio';

  // Google Calendar
  const auth = await getAuthClient();
  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const eventBody = {
      summary: `RDV — ${prenom} ${nom}`,
      description: `Type : ${typeLabel}\nTéléphone : ${tel}\nEmail : ${email}${message ? `\nMessage : ${message}` : ''}`,
      start: { dateTime: startDt.toISOString(), timeZone: 'Europe/Paris' },
      end:   { dateTime: endDt.toISOString(),   timeZone: 'Europe/Paris' },
      colorId: '6',
    };
    if (slot.gcalEventId) {
      await calendar.events.patch({ calendarId: 'primary', eventId: slot.gcalEventId, sendUpdates: 'none', requestBody: eventBody });
    } else {
      await calendar.events.insert({ calendarId: 'primary', sendUpdates: 'none', requestBody: eventBody });
    }
  } catch(e) { console.error('CALENDAR ERROR:', e.message); }

  // Emails via Brevo
  const s = `font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#2B2927;line-height:1.8;`;
  const tL = `padding:0.6rem 0;border-bottom:1px solid #E8E2D9;color:#6B6560;width:130px;`;
  const tR = `padding:0.6rem 0;border-bottom:1px solid #E8E2D9;`;
  const details = `
    <table style="width:100%;border-collapse:collapse;margin:1.5rem 0;font-size:0.88rem;">
      <tr><td style="${tL}">Patient·e</td><td style="${tR}"><strong>${prenom} ${nom}</strong></td></tr>
      <tr><td style="${tL}">Date</td><td style="${tR}">${dateStr}</td></tr>
      <tr><td style="${tL}">Heure</td><td style="${tR}">${timeStr}</td></tr>
      <tr><td style="${tL}">Type</td><td style="${tR}">${typeCourt}</td></tr>
      <tr><td style="${tL}">Téléphone</td><td style="${tR}">${tel}</td></tr>
    </table>
    ${message ? `<p style="font-style:italic;color:#6B6560;font-size:0.85rem;border-left:2px solid #C48A71;padding-left:1rem;">"${message}"</p>` : ''}`;
  const footer = `<p style="font-size:0.78rem;color:#6B6560;margin-top:2rem;border-top:1px solid #E8E2D9;padding-top:1rem;">
    Elisa de Bussy — Psychopraticienne &amp; thérapeute<br>
    25bis avenue du Bédat, 33700 Mérignac<br>
    <a href="tel:+33670936138" style="color:#C48A71;">06 70 93 61 38</a> · 
    <a href="mailto:${process.env.PRAT_EMAIL}" style="color:#C48A71;">${process.env.PRAT_EMAIL}</a>
  </p>`;

  try {
    await sendBrevoEmail({
      to: process.env.PRAT_EMAIL, toName: 'Elisa de Bussy',
      subject: `Nouveau RDV — ${prenom} ${nom} · ${dateStr} à ${timeStr}`,
      html: `<div style="${s}"><h2 style="font-weight:400;font-size:1.3rem;">Nouvelle réservation</h2>${details}${footer}</div>`
    });
    await sendBrevoEmail({
      to: email, toName: `${prenom} ${nom}`,
      subject: `Votre rendez-vous est confirmé — ${dateStr} à ${timeStr}`,
      html: `<div style="${s}">
        <h2 style="font-weight:400;font-size:1.3rem;">Bonjour ${prenom},</h2>
        <p>Votre rendez-vous a bien été enregistré :</p>
        ${details}
        <p>Pour annuler, contactez-moi au moins 24h à l'avance :<br>
        <a href="tel:+33670936138" style="color:#C48A71;">06 70 93 61 38</a> ou 
        <a href="mailto:${process.env.PRAT_EMAIL}" style="color:#C48A71;">${process.env.PRAT_EMAIL}</a></p>
        ${footer}
      </div>`
    });
  } catch(e) { console.error('EMAIL ERROR:', e.message); }

  return res.status(200).json({ success: true, bookingId });
}
