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

function buildEmailPatient({ prenom, dateStr, timeStr, meetLink }) {
  const accent = '#C48A71';
  const border = '#E8E2D9';
  const muted  = '#6B6560';
  const text   = '#2B2927';
  const bg     = '#FAF8F5';

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Rendez-vous confirmé</title></head>
<body style="margin:0;padding:0;background:#F2EDE8;font-family:Arial,sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:white;border:1px solid ${border};">

    <div style="padding:24px 36px 20px;border-bottom:1px solid ${border};">
      <p style="margin:0;font-family:Georgia,serif;font-size:15px;color:${text};font-weight:400;">Elisa de Bussy</p>
      <p style="margin:2px 0 0;font-size:11px;color:${muted};letter-spacing:0.06em;text-transform:uppercase;">Psychopraticienne · Thérapeute</p>
    </div>

    <div style="padding:36px 36px 28px;">

      <div style="text-align:center;margin:0 0 32px;">
        <p style="margin:0 0 8px;font-size:11px;color:${accent};letter-spacing:0.1em;text-transform:uppercase;">Bonjour ${prenom},</p>
        <p style="margin:0;font-family:Georgia,serif;font-size:26px;color:${text};font-weight:400;line-height:1.2;">Rendez-vous confirmé</p>
      </div>

      <div style="margin:0 0 24px;">
        <p style="margin:0 0 4px;font-size:11px;color:${muted};letter-spacing:0.08em;text-transform:uppercase;">Date</p>
        <p style="margin:0;font-size:16px;color:${text};font-weight:500;">${dateStr} · ${timeStr}</p>
        <p style="margin:4px 0 0;font-size:13px;color:${muted};">Téléconsultation</p>
      </div>

      <div style="height:1px;background:${border};margin:0 0 24px;"></div>

      <div style="margin:0 0 24px;text-align:center;">
        <p style="margin:0 0 4px;font-size:11px;color:${muted};letter-spacing:0.08em;text-transform:uppercase;">Lien de connexion</p>
        <p style="margin:0 0 16px;font-size:13px;color:${muted};line-height:1.6;">Votre séance aura lieu sur Google Meet.<br>Connectez-vous quelques minutes avant l'heure prévue.</p>
        ${meetLink
          ? `<a href="${meetLink}" style="display:inline-block;background:${accent};color:white;font-size:13px;padding:10px 22px;text-decoration:none;font-weight:500;">Rejoindre la séance</a>`
          : `<p style="margin:0;font-size:13px;color:${muted};">Le lien vous sera communiqué par email.</p>`
        }
      </div>

      <div style="height:1px;background:${border};margin:0 0 24px;"></div>

      <div style="margin:0 0 24px;">
        <p style="margin:0 0 4px;font-size:11px;color:${muted};letter-spacing:0.08em;text-transform:uppercase;">Paiement</p>
        <p style="margin:0;font-size:14px;color:${text};">Virement bancaire</p>
        <p style="margin:4px 0 0;font-size:12px;color:${muted};">Tout rendez-vous non annulé 24h à l'avance peut être dû.</p>
      </div>

      <div style="height:1px;background:${border};margin:0 0 24px;"></div>

      <div>
        <p style="margin:0 0 4px;font-size:11px;color:${muted};letter-spacing:0.08em;text-transform:uppercase;">Annulation ou déplacement</p>
        <p style="margin:0;font-size:13px;color:${muted};line-height:1.7;">Pour annuler ou déplacer un rendez-vous, veuillez me contacter :<br>
          <a href="tel:+33670936138" style="color:${accent};text-decoration:none;">06 70 93 61 38</a> · <a href="mailto:${process.env.PRAT_EMAIL}" style="color:${accent};text-decoration:none;">${process.env.PRAT_EMAIL}</a>
        </p>
      </div>

    </div>

    <div style="padding:16px 36px;border-top:1px solid ${border};background:${bg};">
      <p style="margin:0;font-size:11px;color:${muted};">Elisa de Bussy · Psychopraticienne &amp; thérapeute · <a href="https://elisadebussy.fr" style="color:${muted};text-decoration:none;">elisadebussy.fr</a></p>
    </div>

  </div>
</body>
</html>`;
}

function buildEmailPraticien({ prenom, nom, dateStr, timeStr, email, tel, message, meetLink }) {
  const accent = '#C48A71';
  const border = '#E8E2D9';
  const muted  = '#6B6560';
  const text   = '#2B2927';
  const bg     = '#FAF8F5';

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Nouveau RDV</title></head>
<body style="margin:0;padding:0;background:#F2EDE8;font-family:Arial,sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:white;border:1px solid ${border};">

    <div style="padding:24px 36px 20px;border-bottom:1px solid ${border};">
      <p style="margin:0;font-family:Georgia,serif;font-size:15px;color:${text};">Elisa de Bussy</p>
      <p style="margin:2px 0 0;font-size:11px;color:${muted};letter-spacing:0.06em;text-transform:uppercase;">Psychopraticienne · Thérapeute</p>
    </div>

    <div style="padding:36px 36px 28px;">

      <div style="text-align:center;margin:0 0 32px;">
        <p style="margin:0 0 8px;font-size:11px;color:${accent};letter-spacing:0.1em;text-transform:uppercase;">Nouvelle réservation</p>
        <p style="margin:0;font-family:Georgia,serif;font-size:26px;color:${text};font-weight:400;line-height:1.2;">Rendez-vous confirmé</p>
      </div>

      <div style="margin:0 0 24px;">
        <p style="margin:0 0 4px;font-size:11px;color:${muted};letter-spacing:0.08em;text-transform:uppercase;">Date</p>
        <p style="margin:0;font-size:16px;color:${text};font-weight:500;">${dateStr} · ${timeStr}</p>
        <p style="margin:4px 0 0;font-size:13px;color:${muted};">Téléconsultation</p>
      </div>

      <div style="height:1px;background:${border};margin:0 0 24px;"></div>

      <div style="margin:0 0 24px;">
        <p style="margin:0 0 12px;font-size:11px;color:${muted};letter-spacing:0.08em;text-transform:uppercase;">Patient·e</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr><td style="padding:6px 0;border-bottom:1px solid ${border};color:${muted};width:100px;">Nom</td><td style="padding:6px 0;border-bottom:1px solid ${border};color:${text};font-weight:500;">${prenom} ${nom}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid ${border};color:${muted};">Téléphone</td><td style="padding:6px 0;border-bottom:1px solid ${border};color:${text};">${tel}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:${message ? `1px solid ${border}` : 'none'};color:${muted};">Email</td><td style="padding:6px 0;border-bottom:${message ? `1px solid ${border}` : 'none'};color:${text};">${email}</td></tr>
          ${message ? `<tr><td style="padding:6px 0;color:${muted};vertical-align:top;">Message</td><td style="padding:6px 0;color:${text};font-style:italic;">${message}</td></tr>` : ''}
        </table>
      </div>

      ${meetLink ? `
      <div style="height:1px;background:${border};margin:0 0 24px;"></div>
      <div>
        <p style="margin:0 0 4px;font-size:11px;color:${muted};letter-spacing:0.08em;text-transform:uppercase;">Lien Google Meet</p>
        <a href="${meetLink}" style="font-size:13px;color:${accent};">${meetLink}</a>
      </div>` : ''}

    </div>

    <div style="padding:16px 36px;border-top:1px solid ${border};background:${bg};">
      <p style="margin:0;font-size:11px;color:${muted};">Elisa de Bussy · elisadebussy.fr</p>
    </div>

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

  const auth = await getAuthClient();
  let meetLink = null;

  try {
    const calendar = google.calendar({ version: 'v3', auth });

    if (slot.gcalEventId) {
      const originalEvent = await calendar.events.get({ calendarId: 'primary', eventId: slot.gcalEventId });
      const origStart = new Date(originalEvent.data.start.dateTime);
      const origEnd   = new Date(originalEvent.data.end.dateTime);

      await calendar.events.delete({ calendarId: 'primary', eventId: slot.gcalEventId });

      if (origStart < slotStart) {
        await calendar.events.insert({ calendarId: 'primary', sendUpdates: 'none', requestBody: {
          summary: `${typeTag} Disponible`,
          start: { dateTime: origStart.toISOString(), timeZone: 'Europe/Paris' },
          end:   { dateTime: slotStart.toISOString(), timeZone: 'Europe/Paris' },
          colorId: '7',
        }});
      }
      if (slotEnd < origEnd) {
        await calendar.events.insert({ calendarId: 'primary', sendUpdates: 'none', requestBody: {
          summary: `${typeTag} Disponible`,
          start: { dateTime: slotEnd.toISOString(), timeZone: 'Europe/Paris' },
          end:   { dateTime: origEnd.toISOString(), timeZone: 'Europe/Paris' },
          colorId: '7',
        }});
      }

      const allSlotKeys = await redis.keys('slot:slot_gcal_*');
      for (const key of allSlotKeys) {
        const s = await redis.get(key);
        if (s && !s.booked && s.gcalEventId === slot.gcalEventId) {
          await redis.del(key);
        }
      }
    }

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

  } catch(e) { console.error('CALENDAR ERROR:', e.message); }

  try {
    await sendBrevoEmail({
      to: process.env.PRAT_EMAIL,
      toName: 'Elisa de Bussy',
      subject: `Nouveau RDV — ${prenom} ${nom} · ${dateStr} à ${timeStr}`,
      html: buildEmailPraticien({ prenom, nom, dateStr, timeStr, email, tel, message, meetLink })
    });

    await sendBrevoEmail({
      to: email,
      toName: `${prenom} ${nom}`,
      subject: `Votre rendez-vous est confirmé — ${dateStr} à ${timeStr}`,
      html: buildEmailPatient({ prenom, dateStr, timeStr, meetLink })
    });

    console.log('EMAILS OK via Brevo');
  } catch(e) { console.error('EMAIL ERROR:', e.message); }

  return res.status(200).json({ success: true, bookingId });
}
