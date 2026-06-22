// api/admin/data.js — Données backoffice (patients, notes, factures, todos, stats)
// Toutes les routes sont protégées par session cookie

import { Redis } from '@upstash/redis';
import crypto from 'crypto';

const redis = Redis.fromEnv();

function parseCookies(req) {
  const raw = req.headers?.cookie || '';
  if (!raw) return {};
  return Object.fromEntries(
    raw.split(';')
      .map(c => { const [k,...v] = c.trim().split('='); return [k.trim(), decodeURIComponent(v.join('='))]; })
      .filter(([k]) => k)
  );
}

function verifyCookie(req) {
  const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'change-me-in-vercel';
  const cookies = req.cookies || parseCookies(req);
  const cookie = cookies?.admin_session || '';
  if (!cookie) return false;
  const lastDot = cookie.lastIndexOf('.');
  if (lastDot === -1) return false;
  const value = cookie.slice(0, lastDot);
  const sig   = cookie.slice(lastDot + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch { return false; }
}

function uid() {
  return crypto.randomBytes(8).toString('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'same-origin');
  res.setHeader('Content-Type', 'application/json');

  if (!verifyCookie(req)) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  const rawResource = req.query.resource || '';
  const resource = rawResource.split('&')[0];
  const { id } = req.query;
  const method = req.method;

  // BOOKINGS agenda semaine
  if (resource === 'bookings') {
    const weekStart = req.query.weekStart || '';
    const weekEnd   = req.query.weekEnd   || '';
    const keys = await redis.keys('booking:*');
    const all  = (await Promise.all(keys.map(k => redis.get(k)))).filter(Boolean);
    const filtered = all.filter(b => {
      if (!b.datetime) return false;
      const d = b.datetime.split('T')[0];
      if (weekStart && d < weekStart) return false;
      if (weekEnd   && d > weekEnd)   return false;
      return true;
    }).sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    return res.json(filtered);
  }

  // ─── DASHBOARD ────────────────────────────────────────────────────────────
  if (resource === 'dashboard') {
    const now   = new Date();
    const year  = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const today = now.toISOString().split('T')[0];

    const [bookingKeys, invoiceKeys, patientKeys, todoKeys, settings] = await Promise.all([
      redis.keys('booking:*'),
      redis.keys('invoice:*'),
      redis.keys('patient:*'),
      redis.keys(`todo:${today}:*`),
      redis.get('admin:settings')
    ]);

    const allBookings = await Promise.all(bookingKeys.map(k => redis.get(k)));
    const allInvoices = await Promise.all(invoiceKeys.map(k => redis.get(k)));
    const allTodos    = await Promise.all(todoKeys.map(k => redis.get(k)));

    const monthBookings = allBookings.filter(b => b && b.datetime?.startsWith(`${year}-${month}`));
    const todayBookings = allBookings
      .filter(b => b && b.datetime?.startsWith(today))
      .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

    const monthCA = monthBookings.length * (settings?.tarifSeance || 60);
    const objectifCA    = settings?.objectifCA    || 1200;
    const objectifRdv   = settings?.objectifRdv   || 20;
    const tarifSeance   = settings?.tarifSeance   || 60;

    const pendingInvoices = allInvoices.filter(i => i && (i.statut === 'a_envoyer' || i.statut === 'envoyee'));
    const pendingAmount   = pendingInvoices.filter(i => i.statut === 'a_envoyer').reduce((s, i) => s + (i.montant || 0), 0);

    return res.json({
      metrics: {
        rdvMois: monthBookings.length,
        objectifRdv,
        tauxRemplissage: objectifRdv > 0 ? Math.round((monthBookings.length / objectifRdv) * 100) : 0,
        caMois: monthCA,
        objectifCA,
        tauxCA: objectifCA > 0 ? Math.round((monthCA / objectifCA) * 100) : 0,
        facturesEnAttente: pendingInvoices.filter(i => i.statut === 'a_envoyer').length,
        montantEnAttente: pendingAmount,
      },
      rdvAujourdhui: todayBookings,
      todos: allTodos.filter(Boolean).sort((a, b) => a.createdAt > b.createdAt ? 1 : -1),
    });
  }

  // ─── SETTINGS ─────────────────────────────────────────────────────────────
  if (resource === 'settings') {
    if (method === 'GET') {
      const s = await redis.get('admin:settings');
      return res.json(s || { objectifCA: 1200, objectifRdv: 20, tarifSeance: 60 });
    }
    if (method === 'POST') {
      const current = await redis.get('admin:settings') || {};
      const updated = { ...current, ...req.body };
      await redis.set('admin:settings', updated);
      return res.json(updated);
    }
  }

  // ─── PATIENTS ─────────────────────────────────────────────────────────────
  if (resource === 'patients') {
    if (method === 'GET' && !id) {
      const keys = await redis.keys('patient:*');
      const patients = await Promise.all(keys.map(k => redis.get(k)));
      const bookingKeys = await redis.keys('booking:*');
      const bookings = await Promise.all(bookingKeys.map(k => redis.get(k)));
      const result = patients.filter(Boolean).map(p => {
        const patientBookings = bookings.filter(b => b && b.email === p.email);
        return { ...p, nbSeances: patientBookings.length };
      }).sort((a, b) => (b.createdAt || '') > (a.createdAt || '') ? 1 : -1);
      return res.json(result);
    }
    if (method === 'GET' && id) {
      const patient = await redis.get(`patient:${id}`);
      if (!patient) return res.status(404).json({ error: 'Patient introuvable' });
      const bookingKeys = await redis.keys('booking:*');
      const bookings    = (await Promise.all(bookingKeys.map(k => redis.get(k))))
        .filter(b => b && b.email === patient.email)
        .sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
      const noteKeys = await redis.keys(`note:${id}:*`);
      const notes    = (await Promise.all(noteKeys.map(k => redis.get(k))))
        .filter(Boolean)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      return res.json({ patient, bookings, notes });
    }
    if (method === 'POST') {
      const pid = uid();
      const patient = { id: pid, createdAt: new Date().toISOString(), ...req.body };
      await redis.set(`patient:${pid}`, patient);
      return res.status(201).json(patient);
    }
    if (method === 'PUT' && id) {
      const existing = await redis.get(`patient:${id}`);
      if (!existing) return res.status(404).json({ error: 'Patient introuvable' });
      const updated = { ...existing, ...req.body, id };
      await redis.set(`patient:${id}`, updated);
      return res.json(updated);
    }
    if (method === 'DELETE' && id) {
      await redis.del(`patient:${id}`);
      return res.json({ success: true });
    }
  }

  // ─── NOTES ────────────────────────────────────────────────────────────────
  if (resource === 'notes') {
    if (method === 'GET' && id) {
      const note = await redis.get(`note:${id}`);
      if (!note) return res.status(404).json({ error: 'Note introuvable' });
      return res.json(note);
    }
    if (method === 'POST') {
      const nid = uid();
      const { patientId, ...rest } = req.body;
      const date = rest.date || new Date().toISOString().split('T')[0];
      const note = { id: nid, patientId, date, createdAt: new Date().toISOString(), ...rest };
      await redis.set(`note:${patientId}:${date}:${nid}`, note);
      const todoKey = `todo:${date}:note:${patientId}`;
      await redis.del(todoKey);
      return res.status(201).json(note);
    }
    if (method === 'PUT' && id) {
      const [, patientId, date] = id.split(':');
      const key = `note:${id}`;
      const existing = await redis.get(key);
      if (!existing) return res.status(404).json({ error: 'Note introuvable' });
      const updated = { ...existing, ...req.body, updatedAt: new Date().toISOString() };
      await redis.set(key, updated);
      return res.json(updated);
    }
  }

  // ─── FACTURES ─────────────────────────────────────────────────────────────
  if (resource === 'invoices') {
    if (method === 'GET') {
      const keys = await redis.keys('invoice:*');
      const invoices = (await Promise.all(keys.map(k => redis.get(k))))
        .filter(Boolean)
        .sort((a, b) => (b.createdAt || '') > (a.createdAt || '') ? 1 : -1);
      return res.json(invoices);
    }
    if (method === 'POST') {
      const iid = uid();
      const countKeys = await redis.keys('invoice:*');
      const numero = `${new Date().getFullYear()}-${String(countKeys.length + 1).padStart(3, '0')}`;
      const invoice = {
        id: iid,
        numero,
        statut: 'a_envoyer',
        montant: 60,
        createdAt: new Date().toISOString(),
        ...req.body
      };
      await redis.set(`invoice:${iid}`, invoice);
      return res.status(201).json(invoice);
    }
    if (method === 'PUT' && id) {
      const existing = await redis.get(`invoice:${id}`);
      if (!existing) return res.status(404).json({ error: 'Facture introuvable' });
      const updated = { ...existing, ...req.body, id };
      await redis.set(`invoice:${id}`, updated);
      return res.json(updated);
    }
    if (method === 'DELETE' && id) {
      await redis.del(`invoice:${id}`);
      return res.json({ success: true });
    }
  }

  // ─── TODOS ────────────────────────────────────────────────────────────────
  if (resource === 'todos') {
    const today = new Date().toISOString().split('T')[0];
    if (method === 'GET') {
      const keys = await redis.keys(`todo:${today}:*`);
      const todos = (await Promise.all(keys.map(k => redis.get(k)))).filter(Boolean);
      return res.json(todos.sort((a, b) => a.createdAt > b.createdAt ? 1 : -1));
    }
    if (method === 'POST') {
      const tid = uid();
      const todo = { id: tid, done: false, createdAt: new Date().toISOString(), type: 'manuel', ...req.body };
      await redis.set(`todo:${today}:${tid}`, todo, { ex: 7 * 24 * 60 * 60 });
      return res.status(201).json(todo);
    }
    if (method === 'PUT' && id) {
      const key = `todo:${today}:${id}`;
      const existing = await redis.get(key);
      if (!existing) return res.status(404).json({ error: 'Todo introuvable' });
      const updated = { ...existing, ...req.body };
      await redis.set(key, updated, { ex: 7 * 24 * 60 * 60 });
      return res.json(updated);
    }
  }

  // ─── STATS ────────────────────────────────────────────────────────────────
  if (resource === 'stats') {
    const settings    = await redis.get('admin:settings') || {};
    const tarifSeance = settings.tarifSeance || 60;
    const bookingKeys = await redis.keys('booking:*');
    const patientKeys = await redis.keys('patient:*');
    const allBookings = (await Promise.all(bookingKeys.map(k => redis.get(k)))).filter(Boolean);
    const allPatients = (await Promise.all(patientKeys.map(k => redis.get(k)))).filter(Boolean);

    const now   = new Date();
    const year  = now.getFullYear();
    const months = ['01','02','03','04','05','06','07','08','09','10','11','12'];
    const caParMois = months.map(m => {
      const count = allBookings.filter(b => b.datetime?.startsWith(`${year}-${m}`)).length;
      return { mois: m, seances: count, ca: count * tarifSeance };
    });

    const caTotal    = allBookings.length * tarifSeance;
    const patientActif = new Set(allBookings.map(b => b.email)).size;

    return res.json({
      caParMois,
      caTotal,
      totalSeances: allBookings.length,
      totalPatients: allPatients.length,
      patientsActifs: patientActif,
      tarifMoyen: tarifSeance,
      abattementMicroBNC: Math.round(caTotal * 0.5),
      revenuImposable: Math.round(caTotal * 0.5),
    });
  }

  return res.status(404).json({ error: 'Ressource inconnue' });
}
