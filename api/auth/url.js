// api/auth/url.js — Génère l'URL d'autorisation Google pour l'admin

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { OAuth2Client } = await import('google-auth-library');
  
  const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://elisadebussy.fr/api/auth/callback'
  );

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://mail.google.com/'
    ]
  });

  return res.json({ url });
}
