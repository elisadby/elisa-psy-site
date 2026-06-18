// api/auth/callback.js — Reçoit le code OAuth de Google et stocke le refresh token

import { Redis } from '@upstash/redis';
import { google } from 'googleapis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).send(`Erreur OAuth : ${error}`);
  }

  if (!code) {
    return res.status(400).send('Code manquant');
  }

  try {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'https://elisa-psy-site.vercel.app/api/auth/callback'
    );

    const { tokens } = await auth.getToken(code);

    if (tokens.refresh_token) {
      await redis.set('google:refresh_token', tokens.refresh_token);
      console.log('Refresh token stocké avec succès');
    }

    // Stocker aussi l'access token
    await redis.set('google:access_token', tokens.access_token, { ex: 3500 });

    return res.send(`
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <title>Autorisation réussie</title>
        <style>
          body { font-family: Georgia, serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #FAF8F5; color: #2B2927; }
          .box { text-align: center; max-width: 400px; padding: 2rem; }
          h2 { font-weight: 400; margin-bottom: 1rem; }
          p { color: #6B6560; font-size: 0.9rem; }
          a { color: #C48A71; }
        </style>
      </head>
      <body>
        <div class="box">
          <h2>✓ Autorisation réussie !</h2>
          <p>Google Agenda est maintenant connecté à votre site.</p>
          <p><a href="/">Retourner au site</a></p>
        </div>
      </body>
      </html>
    `);

  } catch(e) {
    console.error('AUTH CALLBACK ERROR:', e.message);
    return res.status(500).send(`Erreur : ${e.message}`);
  }
}
