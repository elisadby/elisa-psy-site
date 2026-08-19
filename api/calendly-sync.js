// api/calendly-sync.js — Polling Google Calendar pour détecter les nouveaux RDV Calendly
// Appelé par QStash toutes les minutes

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
    headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
    body: JSON.stringify({
      sender: { name: 'Elisa de Bussy', email: process.env.PRAT_EMAIL },
      to: [{ email: to, name: toName }],
      subject,
      htmlContent: html
    })
  });
  if (!response.ok) throw new Error(`Brevo error: ${await response.text()}`);
  return response.json();
}

function buildConfirmationEmail({ prenom, nom, dateStr, timeStr, meetLink }) {
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
        <p style="margin:0 0 16px;font-size:13px;color:${muted};line-height:1.6;">Votre séance aura lieu en visioconférence.<br>Connectez-vous quelques minutes avant l'heure prévue.</p>
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
        <p style="margin:0;font-size:13px;color:${muted};line-height:1.7;">Pour annuler ou déplacer ce rendez-vous, veuillez me contacter dès que possible :<br>
          <a href="tel:+33743777257" style="color:${accent};text-decoration:none;">07 43 77 72 57</a> · 
          <a href="mailto:${process.env.PRAT_EMAIL}" style="color:${accent};text-decoration:none;">${process.env.PRAT_EMAIL}</a>
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

function buildPraticienEmail({ prenom, nom, email, dateStr, timeStr, meetLink }) {
  const accent = '#C48A71';
  const border = '#E8E2D9';
  const muted  = '#6B6560';
  const text   = '#2B2927';
  const bg     = '#FAF8F5';

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Nouveau RDV</title></head>
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
          <tr><td style="padding:6px 0;color:${muted};">Email</td><td style="padding:6px 0;color:${text};">${email}</td></tr>
        </table>
      </div>
      ${meetLink ? `
      <div style="height:1px;background:${border};margin:0 0 24px;"></div>
      <div>
        <p style="margin:0 0 4px;font-size:11px;color:${muted};letter-spacing:0.08em;text-transform:uppercase;">Lien de connexion</p>
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
  // Vérification QStash ou test manuel
  const signature  = req.headers['upstash-signature'] || '';
  const authHeader = req.headers['authorization'];
  const isManual   = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isQStash   = !!signature;

  if (!isManual && !isQStash) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const auth     = await getAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });

    // Chercher les événements créés dans les 3 dernières minutes
    const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const now   = new Date().toISOString();

    const response = await calendar.events.list({
      calendarId: 'primary',
      updatedMin: since,
      timeMin: new Date().toISOString(),
      singleEvents: true,
      orderBy: 'updated',
    });

    const events = response.data.items || [];
    let processed = 0;

    for (const event of events) {
      // Vérifier que c'est un événement Calendly (contient un invité patient)
      const attendees = event.attendees || [];
      const patientAttendee = attendees.find(a => a.email !== process.env.PRAT_EMAIL && !a.organizer);
      if (!patientAttendee) continue;

      // Vérifier que ce n'est pas un événement déjà traité
      const eventId  = event.id;
      const alreadyDone = await redis.get(`calendly:processed:${eventId}`);
      if (alreadyDone) continue;

      // Extraire les infos
      const patientEmail = patientAttendee.email;
      const fullName     = event.summary?.replace('Elisa de Bussy and ', '').trim() || 'Patient';
      const nameParts    = fullName.split(' ');
      const prenom       = nameParts[0] || fullName;
      const nom          = nameParts.slice(1).join(' ') || '';

      const startTime = new Date(event.start?.dateTime || event.start?.date);
      const dateStr   = startTime.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'Europe/Paris' });
      const timeStr   = startTime.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Paris' });

      // Extraire le lien Meet
      const meetLink = event.hangoutLink || 
        event.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri ||
        event.description?.match(/https:\/\/meet\.google\.com\/[a-z-]+/)?.[0] || null;

      // 1. Envoyer email de confirmation au patient
      await sendBrevoEmail({
        to: patientEmail,
        toName: `${prenom} ${nom}`.trim(),
        subject: `Votre rendez-vous est confirmé — ${dateStr} à ${timeStr}`,
        html: buildConfirmationEmail({ prenom, nom, dateStr, timeStr, meetLink })
      });

      // 2. Envoyer email de notification à la praticienne
      await sendBrevoEmail({
        to: process.env.PRAT_EMAIL,
        toName: 'Elisa de Bussy',
        subject: `Nouveau RDV — ${prenom} ${nom} · ${dateStr} à ${timeStr}`,
        html: buildPraticienEmail({ prenom, nom, email: patientEmail, dateStr, timeStr, meetLink })
      });

      // 3. Créer le booking dans Redis pour le rappel QStash
      const bookingId = `booking_calendly_${eventId}`;
      await redis.set(`booking:${bookingId}`, {
        id: bookingId,
        gcalEventId: eventId,
        prenom, nom,
        email: patientEmail,
        datetime: startTime.toISOString(),
        meetLink,
        reminderSent: false,
        createdAt: new Date().toISOString(),
        source: 'calendly'
      });

      // 4. Créer les todos automatiques dans le backoffice
      const rdvDate   = startTime.toISOString().split('T')[0];
      const rdvDateFR = dateStr;
      const nomComplet = `${prenom} ${nom}`.trim();

      // Todo note de séance
      await redis.set(`todo:${rdvDate}:note_${bookingId}`, {
        id: `note_${bookingId}`,
        texte: `Note séance · ${nomComplet} · ${rdvDateFR}`,
        type: 'note', done: false,
        createdAt: new Date().toISOString()
      }, { ex: 30 * 24 * 60 * 60 });

      // Todo facture
      await redis.set(`todo:${rdvDate}:fact_${bookingId}`, {
        id: `fact_${bookingId}`,
        texte: `Envoyer facture · ${nomComplet} · ${rdvDateFR}`,
        type: 'facture', done: false,
        createdAt: new Date().toISOString()
      }, { ex: 30 * 24 * 60 * 60 });

      // Marquer l'événement comme traité (expire dans 7 jours)
      await redis.set(`calendly:processed:${eventId}`, true, { ex: 7 * 24 * 60 * 60 });

      processed++;
      console.log(`CALENDLY SYNC: traité ${prenom} ${nom} (${patientEmail}) pour le ${dateStr}`);
    }

    return res.json({ success: true, processed, checked: events.length });

  } catch(e) {
    console.error('CALENDLY SYNC ERROR:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
