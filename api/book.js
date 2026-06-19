// api/book.js — Réservation + Google Calendar + Google Meet + emails via Brevo

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

function emailTemplate({ prenom, dateStr, timeStr, meetLink, isPatient }) {
  const accentColor  = '#C48A71';
  const textColor    = '#2B2927';
  const lightText    = '#6B6560';
  const borderColor  = '#E8E2D9';
  const bgColor      = '#FAF8F5';

  const header = `
    <div style="background:${textColor};padding:28px 40px;text-align:center;">
      <p style="margin:0;font-family:Georgia,serif;color:#FAF8F5;font-size:1.1rem;font-weight:400;letter-spacing:0.05em;">Elisa de Bussy</p>
      <p style="margin:4px 0 0;font-family:Arial,sans-serif;color:rgba(250,248,245,0.6);font-size:0.72rem;letter-spacing:0.12em;text-transform:uppercase;">Psychopraticienne · Thérapeute</p>
    </div>`;

  const confirmIcon = `
    <div style="text-align:center;padding:36px 0 20px;">
      <div style="display:inline-block;width:56px;height:56px;background:${bgColor};border-radius:50%;border:2px solid ${accentColor};line-height:56px;font-size:1.5rem;">✓</div>
    </div>`;

  const title = isPatient
    ? `<h1 style="font-family:Georgia,serif;font-weight:400;font-size:1.5rem;color:${textColor};text-align:center;margin:0 0 28px;">Votre rendez-vous est confirmé</h1>`
    : `<h1 style="font-family:Georgia,serif;font-weight:400;font-size:1.5rem;color:${textColor};text-align:center;margin:0 0 28px;">Nouvelle réservation</h1>`;

  const dateBlock = `
    <div style="background:${bgColor};border:1px solid ${borderColor};border-left:3px solid ${accentColor};padding:20px 24px;margin:0 0 20px;">
      <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:0.7rem;letter-spacing:0.12em;text-transform:uppercase;color:${lightText};">Rendez-vous</p>
      <p style="margin:0;font-family:Georgia,serif;font-size:1.25rem;color:${textColor};">${dateStr} <span style="color:${accentColor};">·</span> ${timeStr}</p>
      <p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:0.82rem;color:${lightText};">Téléconsultation</p>
    </div>`;

  const meetBlock = meetLink ? `
    <div style="background:#F0F7FF;border:1px solid #C8DFF7;border-left:3px solid #4285F4;padding:20px 24px;margin:0 0 20px;">
      <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:0.7rem;letter-spacing:0.12em;text-transform:uppercase;color:#4285F4;">Lien de connexion</p>
      <p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:0.82rem;color:${textColor};">Votre séance aura lieu sur Google Meet. Cliquez sur le lien ci-dessous quelques minutes avant l'heure du rendez-vous :</p>
      <a href="${meetLink}" style="display:inline-block;background:#4285F4;color:white;font-family:Arial,sans-serif;font-size:0.82rem;font-weight:600;padding:10px 20px;text-decoration:none;border-radius:4px;">Rejoindre la séance →</a>
      <p style="margin:10px 0 0;font-family:Arial,sans-serif;font-size:0.72rem;color:${lightText};">Ou copiez ce lien : <span style="color:#4285F4;">${meetLink}</span></p>
    </div>` : '';

  const paymentBlock = `
    <div style="border:1px solid ${borderColor};padding:16px 24px;margin:0 0 20px;">
      <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:0.7rem;letter-spacing:0.12em;text-transform:uppercase;color:${lightText};">Paiement</p>
      <p style="margin:0;font-family:Arial,sans-serif;font-size:0.82rem;color:${textColor};">Virement bancaire — à effectuer le jour de la séance.</p>
    </div>`;

  const cancellationBlock = `
    <div style="border:1px solid ${borderColor};padding:16px 24px;margin:0 0 28px;background:#FFFBF9;">
      <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:0.7rem;letter-spacing:0.12em;text-transform:uppercase;color:${lightText};">Politique d'annulation</p>
      <p style="margin:0;font-family:Arial,sans-serif;font-size:0.82rem;color:${textColor};">Tout rendez-vous non annulé <strong>au moins 24h à l'avance</strong> sera dû. Pour annuler ou reporter, contactez-moi dès que possible.</p>
    </div>`;

  const contactBlock = `
    <div style="text-align:center;padding:0 0 12px;">
      <a href="tel:+33670936138" style="font-family:Arial,sans-serif;font-size:0.82rem;color:${accentColor};text-decoration:none;">06 70 93 61 38</a>
      <span style="color:${borderColor};margin:0 8px;">|</span>
      <a href="mailto:${process.env.PRAT_EMAIL}" style="font-family:Arial,sans-serif;font-size:0.82rem;color:${accentColor};text-decoration:none;">${process.env.PRAT_EMAIL}</a>
    </div>`;

  const footer = `
    <div style="border-top:1px solid ${borderColor};padding:20px 40px;text-align:center;background:${bgColor};">
      <p style="margin:0;font-family:Arial,sans-serif;font-size:0.72rem;color:${lightText};">Elisa de Bussy · Psychopraticienne &amp; thérapeute · elisadebussy.fr</p>
    </div>`;

  const greeting = isPatient
    ? `<p style="font-family:Arial,sans-serif;font-size:0.9rem;color:${textColor};margin:0 0 20px;">Bonjour ${prenom},</p>`
    : '';

  return `
    <!DOCTYPE html>
    <html lang="fr">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background:#F2EDE8;">
      <div style="max-width:520px;margin:32px auto;background:white;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        ${header}
        <div style="padding:32px 40px 24px;">
          ${confirmIcon}
          ${title}
          ${greeting}
          ${dateBlock}
          ${isPatient ? meetBlock : ''}
          ${isPatient ? paymentBlock : ''}
          ${isPatient ? cancellationBlock : ''}
          ${contactBlock}
        </div>
        ${footer}
      </div>
    </body>
    </html>`;
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

  const slotStart = new Date(slot.datetime);
  const slotEnd   = new Date(slotStart.getTime() + 60 * 60 * 1000);
  const dateStr   = slotStart.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'Europe/Paris' });
  const timeStr   = slotStart.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Paris' });
  const typeTag   = slot.type === 'cabinet' ? '[CABINET]' : '[VISIO]';

  // Google Calendar + Google Meet
  const auth = await getAuthClient();
  let meetLink = null;

  try {
    const calendar = google.calendar({ version: 'v3', auth });

    if (slot.gcalEventId) {
      const originalEvent = await calendar.events.get({
        calendarId: 'primary',
        eventId: slot.gcalEventId
      });
      const origStart = new Date(originalEvent.data.start.dateTime);
      const origEnd   = new Date(originalEvent.data.end.dateTime);

      await calendar.events.delete({ calendarId: 'primary', eventId: slot.gcalEventId });

      if (origStart < slotStart) {
        await calendar.events.insert({
          calendarId: 'primary', sendUpdates: 'none',
          requestBody: {
            summary: `${typeTag} Disponible`,
            start: { dateTime: origStart.toISOString(), timeZone: 'Europe/Paris' },
            end:   { dateTime: slotStart.toISOString(), timeZone: 'Europe/Paris' },
            colorId: '7',
          }
        });
      }
      if (slotEnd < origEnd) {
        await calendar.events.insert({
          calendarId: 'primary', sendUpdates: 'none',
          requestBody: {
            summary: `${typeTag} Disponible`,
            start: { dateTime: slotEnd.toISOString(), timeZone: 'Europe/Paris' },
            end:   { dateTime: origEnd.toISOString(), timeZone: 'Europe/Paris' },
            colorId: '7',
          }
        });
      }

      // Nettoyer les anciens créneaux libres de cet événement dans Upstash
      const allSlotKeys = await redis.keys('slot:slot_gcal_*');
      for (const key of allSlotKeys) {
        const s = await redis.get(key);
        if (s && !s.booked && s.gcalEventId === slot.gcalEventId) {
          await redis.del(key);
        }
      }
    }

    // Créer l'événement RDV avec Google Meet
    const rdvEvent = await calendar.events.insert({
      calendarId: 'primary',
      sendUpdates: 'none',
      conferenceDataVersion: 1,
      requestBody: {
        summary: `RDV — ${prenom} ${nom}`,
        description: `Téléconsultation\nTéléphone : ${tel}\nEmail : ${email}${message ? `\nMessage : ${message}` : ''}`,
        start: { dateTime: slotStart.toISOString(), timeZone: 'Europe/Paris' },
        end:   { dateTime: slotEnd.toISOString(),   timeZone: 'Europe/Paris' },
        colorId: '11',
        conferenceData: {
          createRequest: {
            requestId: `rdv-${bookingId}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' }
          }
        }
      }
    });

    meetLink = rdvEvent.data.hangoutLink || null;
    console.log('CALENDAR + MEET: OK', meetLink);

  } catch(e) { console.error('CALENDAR ERROR:', e.message); }

  // Emails via Brevo
  try {
    // Email au praticien
    await sendBrevoEmail({
      to: process.env.PRAT_EMAIL,
      toName: 'Elisa de Bussy',
      subject: `Nouveau RDV — ${prenom} ${nom} · ${dateStr} à ${timeStr}`,
      html: emailTemplate({ prenom, dateStr, timeStr, meetLink, isPatient: false }) + `
        <div style="max-width:520px;margin:0 auto;padding:0 40px 24px;background:white;">
          <table style="width:100%;border-collapse:collapse;font-size:0.82rem;font-family:Arial,sans-serif;">
            <tr><td style="padding:8px 0;border-bottom:1px solid #E8E2D9;color:#6B6560;width:110px;">Patient·e</td><td style="padding:8px 0;border-bottom:1px solid #E8E2D9;"><strong>${prenom} ${nom}</strong></td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #E8E2D9;color:#6B6560;">Téléphone</td><td style="padding:8px 0;border-bottom:1px solid #E8E2D9;">${tel}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #E8E2D9;color:#6B6560;">Email</td><td style="padding:8px 0;border-bottom:1px solid #E8E2D9;">${email}</td></tr>
            ${message ? `<tr><td style="padding:8px 0;color:#6B6560;">Message</td><td style="padding:8px 0;font-style:italic;">${message}</td></tr>` : ''}
          </table>
          ${meetLink ? `<p style="margin:16px 0 0;font-family:Arial,sans-serif;font-size:0.82rem;color:#2B2927;">Lien Meet : <a href="${meetLink}" style="color:#4285F4;">${meetLink}</a></p>` : ''}
        </div>`
    });

    // Email au patient
    await sendBrevoEmail({
      to: email,
      toName: `${prenom} ${nom}`,
      subject: `Votre rendez-vous est confirmé — ${dateStr} à ${timeStr}`,
      html: emailTemplate({ prenom, dateStr, timeStr, meetLink, isPatient: true })
    });

    console.log('EMAILS: OK via Brevo');
  } catch(e) { console.error('EMAIL ERROR:', e.message); }

  return res.status(200).json({ success: true, bookingId });
}
