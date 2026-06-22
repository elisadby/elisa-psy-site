// api/reminder.js — Rappels 24h avant le RDV via Brevo
// Envoyé à 8h le matin du jour précédant le RDV
// Premier RDV → avec bouton de confirmation de présence
// RDV suivants → rappel simple sans confirmation

import { Redis } from '@upstash/redis';
import crypto from 'crypto';

const redis = Redis.fromEnv();

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

function buildReminderEmail({ prenom, dateStr, timeStr, meetLink, confirmUrl, isFirstBooking }) {
  const accent = '#C48A71';
  const border = '#E8E2D9';
  const muted  = '#6B6560';
  const text   = '#2B2927';
  const bg     = '#FAF8F5';

  const confirmBlock = isFirstBooking && confirmUrl ? `
    <div style="height:1px;background:${border};margin:0 0 24px;"></div>
    <div style="margin:0 0 24px;text-align:center;">
      <p style="margin:0 0 4px;font-size:11px;color:${muted};letter-spacing:0.08em;text-transform:uppercase;">Confirmation de présence</p>
      <p style="margin:0 0 16px;font-size:13px;color:${muted};line-height:1.6;">Merci de confirmer votre présence en cliquant ci-dessous :</p>
      <a href="${confirmUrl}" style="display:inline-block;background:${accent};color:white;font-size:13px;padding:10px 22px;text-decoration:none;font-weight:500;">Confirmer ma présence</a>
    </div>` : '';

  const meetBlock = meetLink ? `
    <div style="height:1px;background:${border};margin:0 0 24px;"></div>
    <div style="margin:0 0 24px;text-align:center;">
      <p style="margin:0 0 4px;font-size:11px;color:${muted};letter-spacing:0.08em;text-transform:uppercase;">Lien de connexion</p>
      <p style="margin:0 0 16px;font-size:13px;color:${muted};line-height:1.6;">Votre séance aura lieu sur Google Meet.<br>Connectez-vous quelques minutes avant l'heure prévue.</p>
      <a href="${meetLink}" style="display:inline-block;background:#4285F4;color:white;font-size:13px;padding:10px 22px;text-decoration:none;font-weight:500;">Rejoindre la séance</a>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Rappel RDV</title></head>
<body style="margin:0;padding:0;background:#F2EDE8;font-family:Arial,sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:white;border:1px solid ${border};">
    <div style="padding:24px 36px 20px;border-bottom:1px solid ${border};">
      <p style="margin:0;font-family:Georgia,serif;font-size:15px;color:${text};">Elisa de Bussy</p>
      <p style="margin:2px 0 0;font-size:11px;color:${muted};letter-spacing:0.06em;text-transform:uppercase;">Psychopraticienne · Thérapeute</p>
    </div>
    <div style="padding:36px 36px 28px;">
      <div style="text-align:center;margin:0 0 32px;">
        <p style="margin:0 0 8px;font-size:11px;color:${accent};letter-spacing:0.1em;text-transform:uppercase;">Rappel</p>
        <p style="margin:0;font-family:Georgia,serif;font-size:26px;color:${text};font-weight:400;line-height:1.2;">Votre rendez-vous est demain</p>
      </div>
      <div style="margin:0 0 24px;">
        <p style="margin:0 0 4px;font-size:11px;color:${muted};letter-spacing:0.08em;text-transform:uppercase;">Date</p>
        <p style="margin:0;font-size:16px;color:${text};font-weight:500;">${dateStr} · ${timeStr}</p>
        <p style="margin:4px 0 0;font-size:13px;color:${muted};">Téléconsultation</p>
      </div>
      ${confirmBlock}
      ${meetBlock}
      <div style="height:1px;background:${border};margin:0 0 24px;"></div>
      <div>
        <p style="margin:0 0 4px;font-size:11px;color:${muted};letter-spacing:0.08em;text-transform:uppercase;">Annulation ou déplacement</p>
        <p style="margin:0;font-size:13px;color:${muted};line-height:1.7;">Pour annuler ou déplacer ce rendez-vous, veuillez me contacter dès que possible :<br>
          <a href="tel:+33670936138" style="color:${accent};text-decoration:none;">06 70 93 61 38</a> · 
          <a href="mailto:${process.env.PRAT_EMAIL}" style="color:${accent};text-decoration:none;">${process.env.PRAT_EMAIL}</a>
        </p>
      </div>
    </div>
    <div style="padding:16px 36px;border-top:1px solid ${border};background:${bg};">
      <p style="margin:0;font-size:11px;color:${muted};">Elisa de Bussy · Psychopraticienne &amp; thérapeute · <a href="https://elisadebussy.fr" style="color:${muted};text-decoration:none;">elisadebussy.fr</a></p>
    </div>
  </div>
</body></html>`;
}

export default async function handler(req, res) {
  // Sécurisation via header Authorization: Bearer <CRON_SECRET> (format Vercel Cron)
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now     = new Date();
  // Cibler les RDV qui ont lieu demain entre 8h et 8h+1h (fenêtre d'envoi)
  // Le cron tourne à 8h UTC = 10h Paris en été
  // On cherche les RDV dans les 24h à venir
  const in23h   = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const in25h   = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const allKeys = await redis.keys('booking:*');
  let remindersSent = 0;

  for (const key of allKeys) {
    const booking = await redis.get(key);
    if (!booking || booking.reminderSent) continue;

    const rdvTime = new Date(booking.datetime);
    if (rdvTime < in23h || rdvTime > in25h) continue;

    try {
      const dateStr = rdvTime.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'Europe/Paris' });
      const timeStr = rdvTime.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Paris' });

      // Vérifier si c'est la première réservation de ce patient
      const allBookings = await Promise.all(allKeys.map(k => redis.get(k)));
      const patientBookings = allBookings
        .filter(b => b && b.email === booking.email)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const isFirstBooking = patientBookings[0]?.id === booking.id;

      // Générer un token unique pour la confirmation (seulement premier RDV)
      let confirmUrl = null;
      if (isFirstBooking) {
        const token = crypto.randomBytes(32).toString('hex');
        await redis.set(`confirm_token:${token}`, booking.id, { ex: 48 * 60 * 60 }); // expire dans 48h
        confirmUrl = `https://elisadebussy.fr/api/confirm?token=${token}`;
      }

      // Récupérer le lien Meet depuis la réservation
      const meetLink = booking.meetLink || null;

      await sendBrevoEmail({
        to: booking.email,
        toName: `${booking.prenom} ${booking.nom}`,
        subject: `Rappel — votre rendez-vous demain à ${timeStr}`,
        html: buildReminderEmail({ prenom: booking.prenom, dateStr, timeStr, meetLink, confirmUrl, isFirstBooking })
      });

      await redis.set(key, { ...booking, reminderSent: true });
      remindersSent++;

    } catch(e) {
      console.error(`REMINDER ERROR for ${booking.id}:`, e.message);
    }
  }

  return res.json({ success: true, remindersSent });
}
