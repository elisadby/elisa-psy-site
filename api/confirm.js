// api/confirm.js — Confirmation de présence du patient

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
  return auth;
}

export default async function handler(req, res) {
  const { token } = req.query;
  if (!token) return res.status(400).send('Lien invalide.');

  // Récupérer la réservation via le token
  const bookingId = await redis.get(`confirm_token:${token}`);
  if (!bookingId) {
    return res.status(200).send(`
      <!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1.0">
      <title>Confirmation</title>
      <style>body{font-family:Georgia,serif;background:#FAF8F5;color:#2B2927;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
      .box{text-align:center;max-width:400px;padding:2rem;}h2{font-weight:400;font-size:1.5rem;}p{color:#6B6560;font-size:0.9rem;line-height:1.7;}</style>
      </head><body><div class="box">
        <p style="font-size:2rem;margin:0 0 1rem;">✓</p>
        <h2>Présence déjà confirmée</h2>
        <p>Votre présence a déjà été enregistrée. À très bientôt !</p>
      </div></body></html>`);
  }

  const booking = await redis.get(`booking:${bookingId}`);
  if (!booking) return res.status(404).send('Réservation introuvable.');

  if (booking.confirmed) {
    return res.status(200).send(`
      <!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1.0">
      <title>Confirmation</title>
      <style>body{font-family:Georgia,serif;background:#FAF8F5;color:#2B2927;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
      .box{text-align:center;max-width:400px;padding:2rem;}h2{font-weight:400;font-size:1.5rem;}p{color:#6B6560;font-size:0.9rem;line-height:1.7;}</style>
      </head><body><div class="box">
        <p style="font-size:2rem;margin:0 0 1rem;">✓</p>
        <h2>Présence déjà confirmée</h2>
        <p>Votre présence a déjà été enregistrée. À très bientôt !</p>
      </div></body></html>`);
  }

  // Marquer comme confirmé
  const confirmedAt = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  await redis.set(`booking:${bookingId}`, { ...booking, confirmed: true, confirmedAt });
  await redis.del(`confirm_token:${token}`);

  // Mettre à jour Google Agenda
  try {
    const auth     = await getAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });

    // Trouver l'événement RDV dans Google Agenda
    const startDt = new Date(booking.datetime);
    const endDt   = new Date(startDt.getTime() + 60 * 60 * 1000);

    const events = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startDt.toISOString(),
      timeMax: endDt.toISOString(),
      q: `${booking.prenom} ${booking.nom}`,
      singleEvents: true
    });

    const rdvEvent = events.data.items?.find(e =>
      e.summary?.includes(booking.prenom) && e.summary?.includes(booking.nom)
    );

    if (rdvEvent) {
      const currentDesc = rdvEvent.description || '';
      await calendar.events.patch({
        calendarId: 'primary',
        eventId: rdvEvent.id,
        sendUpdates: 'none',
        requestBody: {
          summary: `✓ RDV — ${booking.prenom} ${booking.nom}`,
          description: currentDesc + `\n\n✓ Présence confirmée le ${confirmedAt}`
        }
      });
    }

    // Email de notification au praticien
    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: 'Elisa de Bussy', email: process.env.PRAT_EMAIL },
        to: [{ email: process.env.PRAT_EMAIL, name: 'Elisa de Bussy' }],
        subject: `✓ Présence confirmée — ${booking.prenom} ${booking.nom}`,
        htmlContent: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#2B2927;">
          <p style="font-size:14px;"><strong>${booking.prenom} ${booking.nom}</strong> a confirmé sa présence pour le rendez-vous du <strong>${new Date(booking.datetime).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', timeZone:'Europe/Paris' })} à ${new Date(booking.datetime).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Paris' })}</strong>.</p>
          <p style="font-size:12px;color:#6B6560;">Confirmation reçue le ${confirmedAt}</p>
        </div>`
      })
    });

  } catch(e) { console.error('CONFIRM UPDATE ERROR:', e.message); }

  return res.status(200).send(`
    <!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1.0">
    <title>Présence confirmée</title>
    <style>
      body{font-family:Georgia,serif;background:#FAF8F5;color:#2B2927;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
      .box{text-align:center;max-width:420px;padding:2rem;}
      .check{width:60px;height:60px;border-radius:50%;background:#C48A71;color:white;font-size:1.6rem;display:flex;align-items:center;justify-content:center;margin:0 auto 1.5rem;}
      h2{font-weight:400;font-size:1.6rem;margin:0 0 0.75rem;}
      p{color:#6B6560;font-size:0.88rem;line-height:1.8;margin:0;}
      a{color:#C48A71;text-decoration:none;}
    </style>
    </head><body><div class="box">
      <div class="check">✓</div>
      <h2>Merci ${booking.prenom} !</h2>
      <p>Votre présence est confirmée pour le<br>
      <strong style="color:#2B2927;">${new Date(booking.datetime).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'Europe/Paris' })} à ${new Date(booking.datetime).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Paris' })}</strong>.</p>
      <p style="margin-top:1.5rem;">À très bientôt,<br><strong style="color:#2B2927;">Elisa de Bussy</strong></p>
    </div></body></html>`);
}
