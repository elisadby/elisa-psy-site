// api/book.js — avec logs détaillés pour debug
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

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
  const booking = { ...slot, booked: true, patient: { prenom, nom, email, tel, message } };
  await redis.set(`slot:${slotId}`, booking);

  // 3. Sauvegarder la réservation
  const bookingRecord = {
    id: `booking_${Date.now()}`,
    slotId,
    datetime: slot.datetime,
    type: slot.type,
    prenom, nom, email, tel, message,
    createdAt: new Date().toISOString()
  };
  await redis.set(`booking:${bookingRecord.id}`, bookingRecord);

  // 4. Vérifier les variables d'environnement
  const envCheck = {
    hasClientId: !!process.env.GOOGLE_CLIENT_ID,
    hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
    hasRefreshToken: !!process.env.GOOGLE_REFRESH_TOKEN,
    hasPratEmail: !!process.env.PRAT_EMAIL,
    refreshTokenStart: process.env.GOOGLE_REFRESH_TOKEN?.slice(0, 10) || 'MANQUANT'
  };
  console.log('ENV CHECK:', JSON.stringify(envCheck));

  // 5. Google Calendar
  let calendarError = null;
  try {
    const { google } = await import('googleapis');
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const calendar = google.calendar({ version: 'v3', auth });
    const startDt = new Date(slot.datetime);
    const endDt   = new Date(startDt.getTime() + 60 * 60 * 1000);
    const typeLabel = slot.type === 'cabinet'
      ? 'Cabinet — 25bis avenue du Bédat, 33700 Mérignac'
      : 'Téléconsultation (visio)';

    await calendar.events.insert({
      calendarId: 'primary',
      sendUpdates: 'all',
      requestBody: {
        summary: `RDV — ${prenom} ${nom}`,
        description: `Type : ${typeLabel}\nTéléphone : ${tel}\nEmail : ${email}${message ? `\nMessage : ${message}` : ''}`,
        start: { dateTime: startDt.toISOString(), timeZone: 'Europe/Paris' },
        end:   { dateTime: endDt.toISOString(),   timeZone: 'Europe/Paris' },
        attendees: [{ email: process.env.PRAT_EMAIL }, { email }],
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 },
            { method: 'popup', minutes: 60 }
          ]
        }
      }
    });
    console.log('CALENDAR: OK');
  } catch(e) {
    calendarError = e.message;
    console.error('CALENDAR ERROR:', e.message);
  }

  // 6. Email
  let emailError = null;
  try {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: process.env.PRAT_EMAIL,
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
      }
    });

    const startDt   = new Date(slot.datetime);
    const dateStr   = startDt.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    const timeStr   = startDt.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Paris' });
    const typeLabel = slot.type === 'cabinet' ? 'Au cabinet (Mérignac)' : 'Téléconsultation (visio)';

    const emailBody = `
      <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#2B2927;line-height:1.7;">
        <h2 style="font-weight:400;font-size:1.4rem;">Rendez-vous confirmé</h2>
        <p><strong>${prenom} ${nom}</strong> — ${dateStr} à ${timeStr} — ${typeLabel}</p>
        <p>Téléphone : ${tel}</p>
        ${message ? `<p style="font-style:italic;">"${message}"</p>` : ''}
        <p style="font-size:0.82rem;color:#6B6560;margin-top:2rem;">Elisa de Bussy — Psychopraticienne &amp; thérapeute</p>
      </div>`;

    await transporter.sendMail({
      from: process.env.PRAT_EMAIL,
      to: process.env.PRAT_EMAIL,
      subject: `Nouveau RDV — ${prenom} ${nom} · ${dateStr} ${timeStr}`,
      html: emailBody
    });

    await transporter.sendMail({
      from: `"Elisa de Bussy" <${process.env.PRAT_EMAIL}>`,
      to: email,
      subject: `Votre rendez-vous est confirmé — ${dateStr} à ${timeStr}`,
      html: `<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#2B2927;">
        <h2 style="font-weight:400;">Bonjour ${prenom},</h2>
        <p>Votre rendez-vous a bien été enregistré.</p>
        ${emailBody}
        <p>Pour annuler : <a href="tel:0670936138">06 70 93 61 38</a> ou <a href="mailto:edebussy.psy@gmail.com">edebussy.psy@gmail.com</a></p>
      </div>`
    });
    console.log('EMAIL: OK');
  } catch(e) {
    emailError = e.message;
    console.error('EMAIL ERROR:', e.message);
  }

  return res.status(200).json({
    success: true,
    debug: { envCheck, calendarError, emailError }
  });
}
