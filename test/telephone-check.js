// ─────────────────────────────────────────────────────────────────────────────
// test/telephone-check.js — l'accès MacroDroid, sans Discord.
// Démarre le vrai serveur avec un faux bot, puis se comporte comme le
// téléphone : bonne clé, mauvaise clé, GET qui ne doit rien fermer, etc.
//   node test/telephone-check.js
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dachguard-tel-'));
process.env.PORT = '3998';
delete process.env.DISCORD_TOKEN;

const bot = require('../src/bot');
const appels = [];
const faux = (verbe) => async (channelIds, roleIds, opts) => {
  appels.push({ verbe, channelIds, roleIds, opts });
  const res = channelIds.map((id, i) => ({ ok: i !== 99, channelId: id, name: `salon-${id}` }));
  if (verbe === 'unlock') res.pauses = [];
  return res;
};
bot.lock = faux('lock');
bot.unlock = faux('unlock');
bot.status = () => ({ connected: true, channels: [{ id: 'a1' }, { id: 'a2' }, { id: 'b1' }, { id: 'mod' }], roles: [] });

require('../src/server');
const store = require('../src/store');
const telephone = require('../src/telephone');

const st = store.get();
st.groups = [
  { id: 'g3', name: '3TIN', channelIds: ['a1', 'a2'], roleIds: ['r3'], defaultMessage: '' },
  { id: 'g4', name: '4TIN', channelIds: ['b1'], roleIds: ['r4'], defaultMessage: '' },
];
st.settings.protectedChannelIds = ['mod'];

const BASE = 'http://127.0.0.1:3998/lock';
let ok = 0;
async function t(nom, fn) {
  try { await fn(); ok++; console.log(`  ✅ ${nom}`); }
  catch (err) { console.error(`  ❌ ${nom}\n     ${err.message}`); process.exitCode = 1; }
}
const appel = (chemin, { method = 'POST', cle, ip = '10.0.0.1', body } = {}) => fetch(BASE + chemin, {
  method,
  headers: {
    'Content-Type': 'application/json', 'X-Real-IP': ip,
    ...(cle ? { 'X-DachGuard-Cle': cle } : {}),
  },
  body: body ? JSON.stringify(body) : undefined,
}).then(async r => ({ status: r.status, text: await r.text() }));

(async () => {
  await new Promise(r => setTimeout(r, 300));   // laisser le serveur écouter

  console.log('\n── Sans clé créée ──');
  await t('rien ne passe tant qu aucune clé n existe', async () => {
    const r = await appel('/hook/fermer/3tin', { cle: 'nimporte' });
    assert.strictEqual(r.status, 401);
    assert.strictEqual(appels.length, 0);
  });
  await t('l état du dashboard ne montre jamais la clé', async () => {
    const s = await (await fetch(BASE + '/api/state')).json();
    assert.deepStrictEqual(Object.keys(s.phone).sort(), ['createdAt', 'enabled', 'lastAction', 'lastUsedAt']);
    assert.strictEqual(s.phone.enabled, false);
  });

  const { key } = await (await fetch(BASE + '/api/phone/key', { method: 'POST' })).json();

  console.log('\n── Avec la clé ──');
  await t('la clé est longue et sans caractère à échapper', () => {
    assert.match(key, /^[A-Za-z0-9_-]{32}$/);
  });
  await t('fermer 3tin (casse libre) ferme les salons de 3TIN seulement', async () => {
    const r = await appel('/hook/fermer/3tin?minutes=50', { cle: key });
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.text, '🔒 3TIN : 2/2 salon(s) fermé(s) pour 50 min');
    const a = appels.at(-1);
    assert.deepStrictEqual(a.channelIds, ['a1', 'a2']);
    assert.deepStrictEqual(a.roleIds, ['r3']);
    assert.strictEqual(a.opts.durationMinutes, 50);
    assert.strictEqual(a.opts.source, 'téléphone');
  });
  await t('rouvrir passe par une source manuelle (le planning se met en pause)', async () => {
    const r = await appel('/hook/ouvrir/4TIN', { cle: key });
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(appels.at(-1).verbe, 'unlock');
    assert.strictEqual(appels.at(-1).opts.source, 'téléphone');
  });
  await t('tout fermer épargne les salons protégés', async () => {
    const r = await appel('/hook/tout-fermer', { cle: key });
    assert.strictEqual(r.status, 200, r.text);
    assert.ok(!appels.at(-1).channelIds.includes('mod'));
    assert.deepStrictEqual(appels.at(-1).roleIds.sort(), ['r3', 'r4']);
  });
  await t('la clé passe aussi en Bearer et dans l adresse', async () => {
    const r1 = await fetch(`${BASE}/hook/statut`, { headers: { Authorization: `Bearer ${key}` } });
    assert.strictEqual(r1.status, 200);
    const r2 = await fetch(`${BASE}/hook/statut?cle=${key}`);
    assert.strictEqual(r2.status, 200);
  });
  await t('le statut tient en une ligne', async () => {
    const r = await appel('/hook/statut', { method: 'GET', cle: key });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.text, '3TIN ouverte · 4TIN ouverte');
  });
  await t('?format=json renvoie du JSON', async () => {
    const r = await appel('/hook/fermer/4tin?format=json', { cle: key });
    const j = JSON.parse(r.text);
    assert.strictEqual(j.ok, true);
    assert.strictEqual(j.reussis, 1);
  });
  await t('une classe inconnue répond 404 avec la liste des classes', async () => {
    const r = await appel('/hook/fermer/5tin', { cle: key });
    assert.strictEqual(r.status, 404);
    assert.match(r.text, /3TIN, 4TIN/);
  });

  console.log('\n── Ce qui ne doit rien fermer ──');
  await t('un GET sur « fermer » (aperçu de lien) ne touche à rien', async () => {
    const avant = appels.length;
    const r = await appel(`/hook/fermer/3tin?cle=${key}`, { method: 'GET' });
    assert.strictEqual(r.status, 404);
    assert.strictEqual(appels.length, avant);
  });
  await t('une mauvaise clé est refusée', async () => {
    const r = await appel('/hook/fermer/3tin', { cle: key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A') });
    assert.strictEqual(r.status, 401);
  });
  await t('dix mauvaises clés ferment la porte, même à la bonne', async () => {
    for (let i = 0; i < 10; i++) await appel('/hook/statut', { method: 'GET', cle: 'faux', ip: '10.9.9.9' });
    const r = await appel('/hook/statut', { method: 'GET', cle: key, ip: '10.9.9.9' });
    assert.strictEqual(r.status, 429);
    const ailleurs = await appel('/hook/statut', { method: 'GET', cle: key, ip: '10.0.0.2' });
    assert.strictEqual(ailleurs.status, 200, 'une autre adresse n est pas pénalisée');
  });
  await t('changer la clé invalide l ancienne', async () => {
    await fetch(BASE + '/api/phone/key', { method: 'POST' });
    const r = await appel('/hook/statut', { method: 'GET', cle: key, ip: '10.0.0.3' });
    assert.strictEqual(r.status, 401);
  });
  await t('désactiver coupe tout', async () => {
    const k2 = telephone.key();
    await fetch(BASE + '/api/phone/key', { method: 'DELETE' });
    const r = await appel('/hook/statut', { method: 'GET', cle: k2, ip: '10.0.0.4' });
    assert.strictEqual(r.status, 401);
    assert.strictEqual(telephone.key(), null);
  });

  console.log('\n── Phrases ──');
  await t('un échec partiel et une pause de planning se lisent dans la réponse', () => {
    const res = [{ ok: true }, { ok: false }];
    res.pauses = [{ name: 'Nuit 3TIN' }];
    assert.strictEqual(telephone.phraseAction('ouvrir', '3TIN', res),
      '🔓 3TIN : 1/2 salon(s) rouvert(s) — 1 en échec — planning « Nuit 3TIN » en pause');
  });
  await t('le statut signale un bot hors ligne', () => {
    assert.match(telephone.phraseStatut(st, false, null), /hors ligne/);
  });

  console.log(`\n${ok} vérification(s) réussie(s).`);
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
})();
