// ============================================================
// AEVOR ROBOTICS S.L. — Portal de Precios para Distribuidores
// Login por distribuidor · precio por tier calculado en servidor
// Panel de administración · distribuidores persistidos en Dropbox
// ============================================================
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import path from 'path';
import { downloadJson, uploadJson, dropboxConfigured } from './dropbox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Configuración ----------
const JWT_SECRET = process.env.JWT_SECRET || 'CAMBIA_ESTE_SECRETO_EN_RENDER';
const PRICE_FEED_URL = process.env.PRICE_FEED_URL || '';
const FEED_TTL_MS = parseInt(process.env.FEED_TTL_MS || '300000', 10);
const TOKEN_TTL = process.env.TOKEN_TTL || '12h';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DIST_FILE = process.env.DIST_FILE || '/distribuidores.json';

const TIERS = { SIN: 0, C: 5, 'C+': 10, B: 12, A: 16, 'A+': 20 };
const VALID_TIERS = Object.keys(TIERS);

// ---------- Almacén de distribuidores ----------
let _dists = null;
let _distsLoaded = false;

function seedFromEnv() {
  try { return JSON.parse(process.env.DISTRIBUTORS || '[]'); }
  catch { return []; }
}

async function loadDists(force = false) {
  if (_distsLoaded && !force) return _dists;
  if (dropboxConfigured()) {
    try {
      const { exists, content } = await downloadJson(DIST_FILE);
      if (exists && content) {
        const parsed = JSON.parse(content);
        _dists = Array.isArray(parsed) ? parsed : (parsed.distributors || []);
        _distsLoaded = true;
        return _dists;
      }
      _dists = seedFromEnv();
      if (_dists.length) await saveDists();
      _distsLoaded = true;
      return _dists;
    } catch (e) {
      console.error('Error cargando distribuidores de Dropbox:', e.message);
      _dists = seedFromEnv();
      _distsLoaded = true;
      return _dists;
    }
  }
  _dists = seedFromEnv();
  _distsLoaded = true;
  return _dists;
}

async function saveDists() {
  if (!dropboxConfigured()) {
    throw new Error('Dropbox no configurado: no se pueden guardar cambios. Configura DROPBOX_REFRESH_TOKEN.');
  }
  await uploadJson(DIST_FILE, JSON.stringify(_dists, null, 2));
}

// ---------- Feed de precios ----------
let _feedCache = { data: null, at: 0 };

function normalizeDropboxUrl(u) {
  if (!u) return '';
  let url = u.replace('www.dropbox.com', 'dl.dropboxusercontent.com')
             .replace('://dropbox.com', '://dl.dropboxusercontent.com');
  if (url.includes('dl=0')) url = url.replace('dl=0', 'dl=1');
  else if (!url.includes('dl=1') && !url.includes('raw=1')) url += (url.includes('?') ? '&' : '?') + 'dl=1';
  return url;
}

async function getFeed(force = false) {
  const now = Date.now();
  if (!force && _feedCache.data && now - _feedCache.at < FEED_TTL_MS) return _feedCache.data;
  if (!PRICE_FEED_URL) throw new Error('PRICE_FEED_URL no configurado');
  const res = await fetch(normalizeDropboxUrl(PRICE_FEED_URL), { cache: 'no-store' });
  if (!res.ok) throw new Error('Feed HTTP ' + res.status);
  const json = await res.json();
  const data = json && json.products ? json : { products: json, updatedAt: null };
  _feedCache = { data, at: now };
  return data;
}

function priceForTier(pvp, pct) {
  if (!pct) return pvp;
  return Math.round((pvp - pvp * (pct / 100)) * 100) / 100;
}

// ---------- Auth ----------
function authDist(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    if (p.role === 'admin') return res.status(403).json({ error: 'Usa una cuenta de distribuidor' });
    req.dist = p; next();
  } catch { return res.status(401).json({ error: 'Sesión expirada. Vuelve a entrar.' }); }
}

function authAdmin(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    if (p.role !== 'admin') return res.status(403).json({ error: 'Acceso solo para administrador' });
    next();
  } catch { return res.status(401).json({ error: 'Sesión expirada. Vuelve a entrar.' }); }
}

// ======================= DISTRIBUIDOR =======================
app.post('/api/login', async (req, res) => {
  const { user, password } = req.body || {};
  if (!user || !password) return res.status(400).json({ error: 'Indica usuario y contraseña' });
  const dists = await loadDists();
  const d = dists.find(x => x.user === String(user).toLowerCase().trim());
  const hash = d ? d.hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = await bcrypt.compare(password, hash);
  if (!d || !ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  const token = jwt.sign({ user: d.user, name: d.name, tier: d.tier }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.json({ token, name: d.name, tier: d.tier });
});

app.get('/api/me', authDist, (req, res) => {
  res.json({ user: req.dist.user, name: req.dist.name, tier: req.dist.tier });
});

app.get('/api/prices', authDist, async (req, res) => {
  try {
    const feed = await getFeed();
    const pct = TIERS[req.dist.tier] ?? 0;
    const products = feed.products || {};
    const list = Object.keys(products).map(key => {
      const p = products[key];
      const pvp = Number(p.pvp) || 0;
      const dist = priceForTier(pvp, pct);
      return { modelo: key, nombre: p.nombre || key, cat: p.cat || '', desc: p.desc || '',
               pvp, dist, margen: Math.round((pvp - dist) * 100) / 100 };
    });
    res.json({ tier: req.dist.tier, tierPct: pct, updatedAt: feed.updatedAt || null,
               count: list.length, products: list });
  } catch (e) {
    res.status(502).json({ error: 'No se pudieron cargar los precios', detail: e.message });
  }
});

// ======================= ADMIN =======================
app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body || {};
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Panel admin no configurado (falta ADMIN_PASSWORD)' });
  if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Contraseña incorrecta' });
  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.json({ token });
});

app.get('/api/admin/distributors', authAdmin, async (req, res) => {
  const dists = await loadDists();
  res.json({
    persisted: dropboxConfigured(),
    tiers: VALID_TIERS,
    distributors: dists.map(d => ({ user: d.user, name: d.name, tier: d.tier }))
  });
});

app.post('/api/admin/distributors', authAdmin, async (req, res) => {
  let { user, name, tier, password } = req.body || {};
  user = String(user || '').toLowerCase().trim();
  name = String(name || '').trim();
  tier = String(tier || '').trim();
  if (!user || !/^[a-z0-9-]+$/.test(user)) return res.status(400).json({ error: 'Usuario inválido (solo minúsculas, números y guiones)' });
  if (!name) return res.status(400).json({ error: 'Indica el nombre del distribuidor' });
  if (!VALID_TIERS.includes(tier)) return res.status(400).json({ error: 'Nivel inválido' });
  try {
    const dists = await loadDists();
    const existing = dists.find(d => d.user === user);
    if (existing) {
      existing.name = name; existing.tier = tier;
      if (password) existing.hash = bcrypt.hashSync(password, 10);
    } else {
      if (!password) return res.status(400).json({ error: 'Indica una contraseña para el nuevo distribuidor' });
      dists.push({ user, name, tier, hash: bcrypt.hashSync(password, 10) });
    }
    await saveDists();
    res.json({ ok: true, created: !existing, user, name, tier });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo guardar', detail: e.message });
  }
});

app.post('/api/admin/distributors/:user/password', authAdmin, async (req, res) => {
  const user = String(req.params.user || '').toLowerCase().trim();
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Indica la nueva contraseña' });
  try {
    const dists = await loadDists();
    const d = dists.find(x => x.user === user);
    if (!d) return res.status(404).json({ error: 'Distribuidor no encontrado' });
    d.hash = bcrypt.hashSync(password, 10);
    await saveDists();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'No se pudo guardar', detail: e.message }); }
});

app.delete('/api/admin/distributors/:user', authAdmin, async (req, res) => {
  const user = String(req.params.user || '').toLowerCase().trim();
  try {
    const dists = await loadDists();
    const i = dists.findIndex(x => x.user === user);
    if (i < 0) return res.status(404).json({ error: 'Distribuidor no encontrado' });
    dists.splice(i, 1);
    await saveDists();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'No se pudo guardar', detail: e.message }); }
});

// ---------- Salud ----------
app.get('/healthz', async (req, res) => {
  const dists = await loadDists().catch(() => []);
  res.json({ ok: true, distributors: dists.length, dropbox: dropboxConfigured(), admin: !!ADMIN_PASSWORD });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Portal distribuidores en puerto ' + PORT));
