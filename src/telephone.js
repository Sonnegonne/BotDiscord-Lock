// ─────────────────────────────────────────────────────────────────────────────
// telephone.js — commander DachGuard depuis un téléphone (MacroDroid, Tasker…)
// Une clé propre au téléphone, distincte du mot de passe du portail : elle ne
// donne accès qu'à quelques actions (fermer / rouvrir une classe, tout fermer,
// tout rouvrir, statut) et se révoque depuis le dashboard sans rien toucher
// d'autre. Les réponses sont une ligne de texte, prête pour une notification.
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');
const store = require('./store');

function defaults() {
  return { key: null, createdAt: null, lastUsedAt: null, lastAction: null };
}

function etat() {
  const st = store.get();
  if (!st.phone || typeof st.phone !== 'object') st.phone = defaults();
  return st.phone;
}

// Ce que le dashboard affiche en permanence : jamais la clé elle-même
function resume() {
  const p = etat();
  return { enabled: !!p.key, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt, lastAction: p.lastAction };
}

function genererCle() {
  const p = etat();
  p.key = crypto.randomBytes(24).toString('base64url');
  p.createdAt = new Date().toISOString();
  p.lastUsedAt = null;
  p.lastAction = null;
  store.save(true);
  store.logActivity({ type: 'phone', source: 'dashboard', label: 'Nouvelle clé téléphone — l ancienne ne fonctionne plus' });
  return p.key;
}

function revoquer() {
  Object.assign(etat(), defaults());
  store.save(true);
  store.logActivity({ type: 'phone', source: 'dashboard', label: 'Accès téléphone désactivé' });
}

function cleValide(fournie) {
  const attendue = etat().key;
  if (!attendue || !fournie) return false;
  const a = Buffer.from(String(fournie));
  const b = Buffer.from(attendue);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Clé lue dans l'en-tête (recommandé) ou, à défaut, dans l'adresse
function cleDeLaRequete(req) {
  const h = req.headers || {};
  if (h['x-dachguard-cle']) return String(h['x-dachguard-cle']).trim();
  const auth = String(h.authorization || '');
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  if (req.query && req.query.cle) return String(req.query.cle).trim();
  return null;
}

function noterUsage(action) {
  const p = etat();
  p.lastUsedAt = new Date().toISOString();
  p.lastAction = action;
  store.save();
}

// ─── Freinage des mauvaises clés ────────────────────────────────────────────
// 10 essais ratés en 15 minutes depuis la même adresse → porte fermée 15 min.
const FENETRE_MS = 15 * 60 * 1000;
const ESSAIS_MAX = 10;
const echecs = new Map();   // ip -> { n, depuis }

function bloque(ip, now = Date.now()) {
  const e = echecs.get(ip);
  if (!e) return false;
  if (now - e.depuis > FENETRE_MS) { echecs.delete(ip); return false; }
  return e.n >= ESSAIS_MAX;
}

function noterEchec(ip, now = Date.now()) {
  const e = echecs.get(ip);
  if (!e || now - e.depuis > FENETRE_MS) echecs.set(ip, { n: 1, depuis: now });
  else e.n++;
}

function oublierEchecs(ip) { echecs.delete(ip); }

// ─── Retrouver une classe par son nom ───────────────────────────────────────
// « 3tin », « 3TIN », « 3 TIN » et l'identifiant interne désignent la même classe.
const normaliser = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

function trouverClasse(nom) {
  const groups = store.get().groups;
  const cible = normaliser(nom);
  const g = groups.find(x => x.id === nom) || groups.find(x => normaliser(x.name) === cible);
  if (!g) {
    const noms = groups.map(x => x.name).join(', ') || 'aucune';
    const err = new Error(`Classe « ${nom} » inconnue (classes : ${noms})`);
    err.status = 404;
    throw err;
  }
  return g;
}

// ─── Réponses en une ligne ──────────────────────────────────────────────────
function heure(iso, timezone) {
  return new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: timezone });
}

function phraseAction(verbe, cible, results, extra = {}) {
  const ok = results.filter(r => r.ok).length;
  const total = results.length;
  const icone = verbe === 'fermer' ? '🔒' : '🔓';
  const fait = verbe === 'fermer' ? 'fermé' : 'rouvert';
  let txt = total === 0
    ? `${icone} ${cible} : rien à faire`
    : `${icone} ${cible} : ${ok}/${total} salon(s) ${fait}(s)`;
  if (extra.minutes && ok) txt += ` pour ${extra.minutes} min`;
  if (ok < total) txt += ` — ${total - ok} en échec`;
  const pause = (results.pauses || [])[0];
  if (pause) txt += ` — planning « ${pause.name} » en pause`;
  return txt;
}

function phraseStatut(st, connected, nextEvent) {
  if (!connected) return '⚠️ DachGuard est hors ligne (token à recoller dans le dashboard ?)';
  const parts = st.groups.map(g => {
    const n = g.channelIds.filter(id => st.locks[id]).length;
    if (!n) return `${g.name} ouverte`;
    return n === g.channelIds.length ? `${g.name} fermée` : `${g.name} ${n}/${g.channelIds.length} fermés`;
  });
  let txt = parts.length ? parts.join(' · ') : 'aucune classe configurée';
  if (nextEvent) {
    const quoi = nextEvent.kind === 'unlock' ? 'réouverture' : 'fermeture';
    txt += ` — prochaine ${quoi} ${heure(nextEvent.at, st.settings.timezone)} (${nextEvent.name})`;
  }
  return txt;
}

module.exports = {
  resume, genererCle, revoquer, cleValide, cleDeLaRequete, noterUsage,
  bloque, noterEchec, oublierEchecs, trouverClasse, normaliser,
  phraseAction, phraseStatut, key: () => etat().key,
};
