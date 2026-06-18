// api/auth/url.js — Génère l'URL d'autorisation Google pour l'admin

import { google } from 'googleapis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://elisa-psy-site.vercel.app/api/auth/callback'
  );

  const url = auth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // Force l'obtention d'un nouveau refresh token
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://mail.google.com/'
    ]
  });

  return res.json({ url });
}
