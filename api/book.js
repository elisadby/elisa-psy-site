// api/book.js — Réservation + Google Calendar + email confirmation + rappel 24h

import { Redis } from '@upstash/redis';
import { google } from 'googleapis';
import nodemailer from 'nodemailer';

const redis = Redis.fromEnv();

async function getAuthClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://elisa-psy-site.vercel.app/api/auth/callback'
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

async function sendEmail(transporter, options) {
  return transporter.sendMail(options);
}

function createTransporter(auth) {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: process.env.PRAT_EMAIL,
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      refreshToken: auth.credentials.refresh_token,
    }
  });
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

  // 1. Récupérer le créneau
  const slot = await redis.get(`slot:${slotId}`);
  if (!slot)       return res.status(404).json({ error: 'Créneau introuvable' });
  if (slot.booked) return res.status(409).json({ error: 'Créneau déjà réservé' });

  // 2. Marquer comme réservé
  await redis.set(`slot:${slotId}`, { ...slot, booked: true, patient: { prenom, nom, email, tel, message } });

  // 3. Sauvegarder la réservation
  const bookingId = `booking_${Date.now()}`;
  const bookingRecord = {
    id: bookingId,
    slotId,
    datetime: slot.datetime,
    type: slot.type,
    gcalEventId: slot.gcalEventId || null,
    prenom, nom, email, tel, message,
    createdAt: new Date().toISOString(),
    reminderSent: false
  };
  await redis.set(`booking:${bookingId}`, bookingRecord);

  const startDt   = new Date(slot.datetime);
  const endDt     = new Date(startDt.getTime() + 60 * 60 * 1000);
  const dateStr   = startDt.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'Europe/Paris' });
  const timeStr   = startDt.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Paris' });
  const typeLabel = slot.type === 'cabinet' ? 'Au cabinet — 25bis avenue du Bédat, 33700 Mérignac' : 'Téléconsultation (visio)';
  const typeCourt = slot.type === 'cabinet' ? 'Cabinet · Mérignac' : 'Visio';

  // 4. Mettre à jour Google Agenda : remplacer l'événement "[CABINET/VISIO] Disponible" par le RDV
  const auth = await getAuthClient();
  try {
    const calendar = google.calendar({ version: 'v3', auth });

    if (slot.gcalEventId) {
      // Modifier l'événement existant
      await calendar.events.patch({
        calendarId: 'primary',
        eventId: slot.gcalEventId,
        sendUpdates: 'none',
        requestBody: {
          summary: `RDV — ${prenom} ${nom}`,
          description: `Type : ${typeLabel}\nTéléphone : ${tel}\nEmail : ${email}${message ? `\nMessage : ${message}` : ''}`,
          start: { dateTime: startDt.toISOString(), timeZone: 'Europe/Paris' },
          end:   { dateTime: endDt.toISOString(),   timeZone: 'Europe/Paris' },
          colorId: '6', // Rouge pour les RDV confirmés
        }
      });
    } else {
      // Créer un nouvel événement
      await calendar.events.insert({
        calendarId: 'primary',
        sendUpdates: 'none',
        requestBody: {
          summary: `RDV — ${prenom} ${nom}`,
          description: `Type : ${typeLabel}\nTéléphone : ${tel}\nEmail : ${email}${message ? `\nMessage : ${message}` : ''}`,
          start: { dateTime: startDt.toISOString(), timeZone: 'Europe/Paris' },
          end:   { dateTime: endDt.toISOString(),   timeZone: 'Europe/Paris' },
          colorId: '6',
        }
      });
    }
  } catch(e) {
    console.error('CALENDAR ERROR:', e.message);
  }

  // 5. Email de confirmation immédiat
  try {
    const transporter = createTransporter(auth);

    const emailStyle = `font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#2B2927;line-height:1.8;`;
    const tableStyle = `width:100%;border-collapse:collapse;margin:1.5rem 0;font-size:0.88rem;`;
    const tdLStyle   = `padding:0.6rem 0;border-bottom:1px solid #E8E2D9;color:#6B6560;width:130px;`;
    const tdRStyle   = `padding:0.6rem 0;border-bottom:1px solid #E8E2D9;`;

    const rdvDetails = `
      <table style="${tableStyle}">
        <tr><td style="${tdLStyle}">Patient·e</td><td style="${tdRStyle}"><strong>${prenom} ${nom}</strong></td></tr>
        <tr><td style="${tdLStyle}">Date</td><td style="${tdRStyle}">${dateStr}</td></tr>
        <tr><td style="${tdLStyle}">Heure</td><td style="${tdRStyle}">${timeStr}</td></tr>
        <tr><td style="${tdLStyle}">Type</td><td style="${tdRStyle}">${typeCourt}</td></tr>
        <tr><td style="${tdLStyle}">Téléphone</td><td style="${tdRStyle}">${tel}</td></tr>
      </table>
      ${message ? `<p style="font-style:italic;color:#6B6560;font-size:0.85rem;border-left:2px solid #C48A71;padding-left:1rem;">"${message}"</p>` : ''}`;

    const footer = `<p style="font-size:0.78rem;color:#6B6560;margin-top:2rem;border-top:1px solid #E8E2D9;padding-top:1rem;">
      Elisa de Bussy — Psychopraticienne &amp; thérapeute<br>
      25bis avenue du Bédat, 33700 Mérignac<br>
      <a href="tel:+33670936138" style="color:#C48A71;">06 70 93 61 38</a> · 
      <a href="mailto:edebussy.psy@gmail.com" style="color:#C48A71;">edebussy.psy@gmail.com</a>
    </p>`;

    // Email au praticien
    await sendEmail(transporter, {
      from: process.env.PRAT_EMAIL,
      to: process.env.PRAT_EMAIL,
      subject: `Nouveau RDV — ${prenom} ${nom} · ${dateStr} à ${timeStr}`,
      html: `<div style="${emailStyle}">
        <h2 style="font-weight:400;font-size:1.3rem;">Nouvelle réservation</h2>
        ${rdvDetails}${footer}
      </div>`
    });

    // Email de confirmation au patient
    await sendEmail(transporter, {
      from: `"Elisa de Bussy" <${process.env.PRAT_EMAIL}>`,
      to: email,
      subject: `Votre rendez-vous est confirmé — ${dateStr} à ${timeStr}`,
      html: `<div style="${emailStyle}">
        <h2 style="font-weight:400;font-size:1.3rem;">Bonjour ${prenom},</h2>
        <p>Votre rendez-vous a bien été enregistré. Voici le récapitulatif :</p>
        ${rdvDetails}
        <p>Pour annuler ou modifier ce rendez-vous, merci de me contacter <strong>au moins 24h à l'avance</strong> :</p>
        <p><a href="tel:+33670936138" style="color:#C48A71;">06 70 93 61 38</a> ou 
        <a href="mailto:edebussy.psy@gmail.com" style="color:#C48A71;">edebussy.psy@gmail.com</a></p>
        ${footer}
      </div>`
    });

  } catch(e) {
    console.error('EMAIL ERROR:', e.message);
  }

  return res.status(200).json({ success: true, bookingId });
}
