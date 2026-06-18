// api/reminder.js — Envoi des rappels 24h avant le RDV
// À appeler via un cron job Vercel (toutes les heures)

import { Redis } from '@upstash/redis';
import { google } from 'googleapis';
import nodemailer from 'nodemailer';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  // Sécurisation basique via header secret
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now       = new Date();
  const in24h     = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in25h     = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const allKeys   = await redis.keys('booking:*');
  let remindersSent = 0;

  for (const key of allKeys) {
    const booking = await redis.get(key);
    if (!booking || booking.reminderSent) continue;

    const rdvTime = new Date(booking.datetime);
    // Envoyer le rappel si le RDV est dans la fenêtre 24h-25h
    if (rdvTime >= in24h && rdvTime <= in25h) {
      try {
        // Récupérer le refresh token
        let refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
        try {
          const stored = await redis.get('google:refresh_token');
          if (stored) refreshToken = stored;
        } catch(e) {}

        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            type: 'OAuth2',
            user: process.env.PRAT_EMAIL,
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            refreshToken,
          }
        });

        const dateStr   = rdvTime.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'Europe/Paris' });
        const timeStr   = rdvTime.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Paris' });
        const typeCourt = booking.type === 'cabinet' ? 'Au cabinet — 25bis avenue du Bédat, Mérignac' : 'Téléconsultation (visio)';

        await transporter.sendMail({
          from: `"Elisa de Bussy" <${process.env.PRAT_EMAIL}>`,
          to: booking.email,
          subject: `Rappel — Votre rendez-vous demain à ${timeStr}`,
          html: `
            <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#2B2927;line-height:1.8;">
              <h2 style="font-weight:400;font-size:1.3rem;">Bonjour ${booking.prenom},</h2>
              <p>Ceci est un rappel pour votre rendez-vous de demain :</p>
              <table style="width:100%;border-collapse:collapse;margin:1.5rem 0;font-size:0.88rem;">
                <tr><td style="padding:0.6rem 0;border-bottom:1px solid #E8E2D9;color:#6B6560;width:130px;">Date</td><td style="padding:0.6rem 0;border-bottom:1px solid #E8E2D9;">${dateStr}</td></tr>
                <tr><td style="padding:0.6rem 0;border-bottom:1px solid #E8E2D9;color:#6B6560;">Heure</td><td style="padding:0.6rem 0;border-bottom:1px solid #E8E2D9;">${timeStr}</td></tr>
                <tr><td style="padding:0.6rem 0;color:#6B6560;">Type</td><td style="padding:0.6rem 0;">${typeCourt}</td></tr>
              </table>
              <p>Pour annuler, merci de me contacter dès que possible :<br>
              <a href="tel:+33670936138" style="color:#C48A71;">06 70 93 61 38</a> ou 
              <a href="mailto:edebussy.psy@gmail.com" style="color:#C48A71;">edebussy.psy@gmail.com</a></p>
              <p style="font-size:0.78rem;color:#6B6560;margin-top:2rem;border-top:1px solid #E8E2D9;padding-top:1rem;">
                Elisa de Bussy — Psychopraticienne &amp; thérapeute
              </p>
            </div>`
        });

        // Marquer le rappel comme envoyé
        await redis.set(key, { ...booking, reminderSent: true });
        remindersSent++;

      } catch(e) {
        console.error(`REMINDER ERROR for ${booking.id}:`, e.message);
      }
    }
  }

  return res.json({ success: true, remindersSent });
}
