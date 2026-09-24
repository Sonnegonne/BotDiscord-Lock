// ─────────────────────────────────────────────────────────────────────────────
// server.js — API HTTP + service du dashboard
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const cors = require('cors');
const path = require('path');

const store = require('./store');
const bot = require('./bot');
const groups = require('./groups');
const scheduler = require('./scheduler');
const telephone = require('./telephone');

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

const BASE_PATH = process.env.BASE_PATH || '/lock';
const PORT = process.env.PORT || 3000;
const startedAt = new Date().toISOString();

app.use(BASE_PATH, express.static(path.join(__dirname, '../public'), { maxAge: '1h' }));

// Petit emballage : renvoie toujours du JSON, même en cas d erreur
function route(handler) {
  return async (req, res) => {
    try {
      const out = await handler(req, res);
      if (!res.headersSent) res.json(out === undefined ? { success: true } : out);
    } catch (err) {
      if (!res.headersSent) res.status(err.status || 400).json({ error: err.message });
    }
  };
}

function summarize(results) {
  const ok = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);
  return {
    success: true, ok, total: results.length, results,
    pauses: results.pauses || [],
    errors: failed.map(f => `${f.name || f.channelId} : ${f.error}`),
  };
}

// ─── ÉTAT GLOBAL ────────────────────────────────────────────────────────────
app.get(`${BASE_PATH}/api/state`, route(async () => {
  const st = store.get();
  const status = bot.status();
  const schedules = scheduler.list();

  const lockedChannelIds = Object.keys(st.locks);
  const nextEvent = schedules
    .filter(sc => sc.effectiveActive && sc.nextRun)
    .map(sc => ({ ...sc.nextRun, scheduleId: sc.id, name: sc.name, groupId: sc.groupId }))
    .sort((a, b) => new Date(a.at) - new Date(b.at))[0] || null;

  return {
    ...status,
    startedAt,
    basePath: BASE_PATH,
    settings: st.settings,
    stickerStats: st.stickerStats,
    phone: telephone.resume(),
    groups: st.groups.map(g => {
      const locked = g.channelIds.filter(id => st.locks[id]).length;
      return { ...g, lockedCount: locked, total: g.channelIds.length };
    }),
    schedules,
    locks: st.locks,
    lockedCount: lockedChannelIds.length,
    activity: st.activity.slice(0, 60),
    nextEvent,
  };
}));

// compat : ancien point d entrée
app.get(`${BASE_PATH}/api/status`, route(async () => bot.status()));

// ─── CONNEXION ──────────────────────────────────────────────────────────────
app.post(`${BASE_PATH}/api/connect`, route(async (req) => {
  const { token, remember } = req.body || {};
  const st = store.get();
  if (!token && !st.token) throw new Error('Token requis');
  await bot.connect(token || null, { remember: remember !== false });
  // on laisse le temps au gateway de livrer le premier « ready »
  for (let i = 0; i < 30 && !bot.isReady(); i++) await new Promise(r => setTimeout(r, 250));
  if (!bot.isReady()) throw new Error('Discord n a pas répondu à temps — réessayez');
  return { success: true, status: bot.status() };
}));

app.post(`${BASE_PATH}/api/disconnect`, route(async (req) => {
  await bot.disconnect({ forget: !!(req.body && req.body.forget) });
  return { success: true };
}));

app.post(`${BASE_PATH}/api/refresh`, route(async () => {
  bot.refresh();
  return { success: true, status: bot.status() };
}));

// ─── VERROUILLAGE ───────────────────────────────────────────────────────────
app.post(`${BASE_PATH}/api/lock`, route(async (req) => {
  const { channelIds, roleIds, message, mode, durationMinutes, groupId } = req.body || {};
  if (!channelIds || !channelIds.length) throw new Error('Aucun salon sélectionné');
  if (!roleIds || !roleIds.length) throw new Error('Aucun rôle sélectionné');
  return summarize(await bot.lock(channelIds, roleIds, {
    message, mode, durationMinutes, groupId, source: 'dashboard',
  }));
}));

app.post(`${BASE_PATH}/api/unlock`, route(async (req) => {
  const { channelIds, roleIds, restore } = req.body || {};
  if (!channelIds || !channelIds.length) throw new Error('Aucun salon sélectionné');
  return summarize(await bot.unlock(channelIds, roleIds || [], {
    restore: restore || 'restore', source: 'dashboard',
  }));
}));

// Verrouiller / rouvrir une classe entière
app.post(`${BASE_PATH}/api/groups/:id/lock`, route(async (req) => {
  const { message, durationMinutes, mode } = req.body || {};
  return summarize(await fermerClasse(groups.find(req.params.id), { message, durationMinutes, mode, source: 'dashboard' }));
}));

app.post(`${BASE_PATH}/api/groups/:id/unlock`, route(async (req) => {
  return summarize(await rouvrirClasse(groups.find(req.params.id), { restore: req.body && req.body.restore, source: 'dashboard' }));
}));

// Tout fermer / tout rouvrir — partagé par le dashboard et le téléphone
async function toutFermer({ message, durationMinutes, source }) {
  const st = store.get();
  const { channels } = bot.status();
  const protectedIds = new Set(st.settings.protectedChannelIds);
  const channelIds = channels.filter(c => !protectedIds.has(c.id)).map(c => c.id);
  const roleIds = [...new Set(st.groups.flatMap(g => g.roleIds))];
  if (!roleIds.length) throw new Error('Configurez au moins une classe avec un rôle');
  return bot.lock(channelIds, roleIds, {
    message: message || undefined, durationMinutes: durationMinutes || null,
    source, label: 'fermeture générale',
  });
}

async function toutRouvrir({ restore, source }) {
  const channelIds = Object.keys(store.get().locks);
  if (!channelIds.length) return [];
  return bot.unlock(channelIds, [], { restore: restore || 'restore', source, label: 'réouverture générale' });
}

async function fermerClasse(g, { message, durationMinutes, mode, source }) {
  if (!g.channelIds.length) throw new Error(`Aucun salon configuré pour ${g.name}`);
  if (!g.roleIds.length) throw new Error(`Aucun rôle configuré pour ${g.name}`);
  return bot.lock(g.channelIds, g.roleIds, {
    message: message !== undefined ? message : (g.defaultMessage || undefined),
    durationMinutes, mode, groupId: g.id, source, label: g.name,
  });
}

async function rouvrirClasse(g, { restore, source }) {
  return bot.unlock(g.channelIds, g.roleIds, { restore: restore || 'restore', source, label: g.name });
}

app.post(`${BASE_PATH}/api/panic`, route(async (req) => {
  const b = req.body || {};
  return summarize(await toutFermer({ message: b.message, durationMinutes: b.durationMinutes, source: 'dashboard' }));
}));

app.post(`${BASE_PATH}/api/release-all`, route(async (req) => {
  return summarize(await toutRouvrir({ restore: req.body && req.body.restore, source: 'dashboard' }));
}));

app.post(`${BASE_PATH}/api/diagnose`, route(async (req) => {
  const { channelIds, roleIds, mode } = req.body || {};
  return bot.diagnose(channelIds || [], roleIds || [], mode || 'auto');
}));

// ─── CLASSES ────────────────────────────────────────────────────────────────
app.get(`${BASE_PATH}/api/groups`, route(async () => groups.list()));
app.post(`${BASE_PATH}/api/groups`, route(async (req) => ({ success: true, group: groups.create(req.body || {}) })));
app.put(`${BASE_PATH}/api/groups/:id`, route(async (req) => ({ success: true, group: groups.update(req.params.id, req.body || {}) })));
app.delete(`${BASE_PATH}/api/groups/:id`, route(async (req) => { groups.remove(req.params.id); return { success: true }; }));

app.patch(`${BASE_PATH}/api/groups/:id/toggle`, route(async (req) => {
  const g = groups.toggle(req.params.id);
  scheduler.refreshGroup(g.id);
  return { success: true, group: g };
}));

app.get(`${BASE_PATH}/api/groups-detect`, route(async () => groups.detect()));
app.post(`${BASE_PATH}/api/groups-detect`, route(async (req) => {
  const applied = groups.applyDetection((req.body && req.body.levels) || null);
  scheduler.registerAll();
  return { success: true, groups: applied };
}));

// ─── PLANIFICATIONS ─────────────────────────────────────────────────────────
app.get(`${BASE_PATH}/api/schedules`, route(async () => scheduler.list()));
app.post(`${BASE_PATH}/api/schedules`, route(async (req) => ({ success: true, schedule: scheduler.create(req.body || {}) })));
app.put(`${BASE_PATH}/api/schedules/:id`, route(async (req) => ({ success: true, schedule: scheduler.update(req.params.id, req.body || {}) })));
app.delete(`${BASE_PATH}/api/schedules/:id`, route(async (req) => { scheduler.remove(req.params.id); return { success: true }; }));
app.patch(`${BASE_PATH}/api/schedules/:id/toggle`, route(async (req) => ({ success: true, schedule: scheduler.toggle(req.params.id) })));

// Lever la pause posée par une réouverture manuelle
app.post(`${BASE_PATH}/api/schedules/:id/resume`, route(async (req) => {
  const st = store.get();
  const sc = st.schedules.find(x => x.id === req.params.id);
  if (!sc) throw new Error('Planification introuvable');
  sc.overrideUntil = null;
  sc.overrideSource = null;
  store.save();
  return { success: true, schedules: scheduler.list() };
}));

// Lancer une planification tout de suite (test)
app.post(`${BASE_PATH}/api/schedules/:id/run`, route(async (req) => {
  const st = store.get();
  const sc = st.schedules.find(x => x.id === req.params.id);
  if (!sc) throw new Error('Planification introuvable');
  const { channelIds, roleIds } = scheduler.resolveTargets(sc);
  const action = (req.body && req.body.action) || 'lock';
  const results = action === 'unlock'
    ? await bot.unlock(channelIds, roleIds, { restore: 'restore', source: 'test', label: sc.name })
    : await bot.lock(channelIds, roleIds, {
        message: sc.lockMessage === null ? undefined : sc.lockMessage,
        mode: sc.mode, groupId: sc.groupId, scheduleId: sc.id, source: 'test', label: sc.name,
      });
  return summarize(results);
}));

// ─── RÉGLAGES ───────────────────────────────────────────────────────────────
app.put(`${BASE_PATH}/api/settings`, route(async (req) => {
  const st = store.get();
  const body = req.body || {};
  const allowed = ['timezone', 'strictLock', 'announceLock', 'announceUnlock',
                   'defaultLockMessage', 'protectedChannelIds', 'slashCommands'];
  for (const key of allowed) if (body[key] !== undefined) st.settings[key] = body[key];

  // Garde anti-stickers : réglage imbriqué, mis à jour clé par clé
  if (body.stickerGuard && typeof body.stickerGuard === 'object') {
    const g = st.settings.stickerGuard;
    const bools = ['enabled', 'allowStaff', 'allowBots', 'warn'];
    for (const key of bools) if (body.stickerGuard[key] !== undefined) g[key] = !!body.stickerGuard[key];
    for (const key of ['exemptChannelIds', 'exemptRoleIds']) {
      if (Array.isArray(body.stickerGuard[key])) g[key] = body.stickerGuard[key].map(String);
    }
    if (body.stickerGuard.warnMessage !== undefined) {
      g.warnMessage = String(body.stickerGuard.warnMessage).slice(0, 300);
    }
    if (body.stickerGuard.warnSeconds !== undefined) {
      g.warnSeconds = Math.min(120, Math.max(3, Number(body.stickerGuard.warnSeconds) || 10));
    }
  }
  store.save(true);
  bot.refresh();
  scheduler.registerAll();
  if (body.slashCommands !== undefined) await bot.registerSlashCommands();
  return { success: true, settings: st.settings };
}));

app.post(`${BASE_PATH}/api/stickers/reset`, route(async () => {
  const st = store.get();
  st.stickerStats = { removed: 0, lastAt: null, lastUser: null, lastChannel: null, lastError: null };
  store.save(true);
  return { success: true, stickerStats: st.stickerStats };
}));

app.get(`${BASE_PATH}/api/activity`, route(async () => store.get().activity));

// ─── TÉLÉPHONE (MacroDroid) ─────────────────────────────────────────────────
// Côté dashboard (derrière le mot de passe du portail) : gérer la clé.
app.get(`${BASE_PATH}/api/phone`, route(async () => ({ ...telephone.resume(), key: telephone.key() })));
app.post(`${BASE_PATH}/api/phone/key`, route(async () => ({ success: true, key: telephone.genererCle(), ...telephone.resume() })));
app.delete(`${BASE_PATH}/api/phone/key`, route(async () => { telephone.revoquer(); return { success: true }; }));

// Côté téléphone : /lock/hook/…, exempté du mot de passe du portail par nginx,
// gardé par la clé seule. Réponse = une ligne de texte (ou JSON avec ?format=json).
const HOOK = `${BASE_PATH}/hook`;

function hook(action, handler) {
  return async (req, res) => {
    const ip = req.headers['x-real-ip'] || req.socket.remoteAddress;
    const json = req.query.format === 'json';
    const reply = (status, text, extra = {}) => {
      res.status(status);
      if (json) res.json({ ok: status < 400, text, ...extra });
      else res.type('text/plain; charset=utf-8').send(text);
    };

    if (telephone.bloque(ip)) return reply(429, '⛔ Trop d essais avec une mauvaise clé — réessayez dans 15 min');
    if (!telephone.cleValide(telephone.cleDeLaRequete(req))) {
      telephone.noterEchec(ip);
      return reply(401, '⛔ Clé téléphone refusée');
    }
    telephone.oublierEchecs(ip);

    try {
      const { text, results } = await handler(req);
      telephone.noterUsage(action);
      const failed = (results || []).filter(r => !r.ok);
      reply(200, text, results ? { reussis: results.length - failed.length, total: results.length } : {});
    } catch (err) {
      reply(err.status || 400, `❌ ${err.message}`);
    }
  };
}

const minutesDe = req => {
  const v = Number((req.body && req.body.minutes) || req.query.minutes);
  return v > 0 ? Math.min(v, 24 * 60) : null;
};
const messageDe = req => {
  const v = (req.body && req.body.message) || req.query.message;
  return v ? String(v).slice(0, 500) : undefined;
};

app.get(`${HOOK}/statut`, hook('statut', async () => {
  const { connected } = bot.status();
  const nextEvent = scheduler.list()
    .filter(sc => sc.effectiveActive && sc.nextRun)
    .map(sc => ({ ...sc.nextRun, name: sc.name }))
    .sort((a, b) => new Date(a.at) - new Date(b.at))[0] || null;
  return { text: telephone.phraseStatut(store.get(), connected, nextEvent) };
}));

app.get(`${HOOK}/classes`, hook('classes', async () => ({
  text: store.get().groups.map(g => g.name).join(', ') || 'aucune classe configurée',
})));

// Les actions ne répondent qu'en POST : un aperçu de lien (Discord, messagerie)
// fait un GET, et ne doit jamais fermer une classe par accident.
app.post(`${HOOK}/fermer/:classe`, hook('fermer', async (req) => {
  const g = telephone.trouverClasse(req.params.classe);
  const minutes = minutesDe(req);
  const results = await fermerClasse(g, { message: messageDe(req), durationMinutes: minutes, source: 'téléphone' });
  return { results, text: telephone.phraseAction('fermer', g.name, results, { minutes }) };
}));

app.post(`${HOOK}/ouvrir/:classe`, hook('ouvrir', async (req) => {
  const g = telephone.trouverClasse(req.params.classe);
  const results = await rouvrirClasse(g, { source: 'téléphone' });
  return { results, text: telephone.phraseAction('ouvrir', g.name, results) };
}));

app.post(`${HOOK}/tout-fermer`, hook('tout-fermer', async (req) => {
  const minutes = minutesDe(req);
  const results = await toutFermer({ message: messageDe(req), durationMinutes: minutes, source: 'téléphone' });
  return { results, text: telephone.phraseAction('fermer', 'Tout le serveur', results, { minutes }) };
}));

app.post(`${HOOK}/tout-ouvrir`, hook('tout-ouvrir', async () => {
  const results = await toutRouvrir({ source: 'téléphone' });
  return { results, text: telephone.phraseAction('ouvrir', 'Tout le serveur', results) };
}));

app.all(`${HOOK}/*rest`, (req, res) => {
  res.status(404).type('text/plain; charset=utf-8').send(req.method === 'GET'
    ? '❌ En GET : statut et classes seulement — fermer et ouvrir se déclenchent en POST'
    : '❌ Action inconnue : statut, classes, fermer/<classe>, ouvrir/<classe>, tout-fermer, tout-ouvrir');
});

// ─── PAGE ───────────────────────────────────────────────────────────────────
app.get(BASE_PATH, (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get(`${BASE_PATH}/*path`, (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

// ─── DÉMARRAGE ──────────────────────────────────────────────────────────────
async function boot() {
  store.load();

  bot.bus.on('ready', async () => {
    try {
      groups.seed();
      scheduler.registerAll();
      await scheduler.reconcile();
      await bot.registerSlashCommands();
    } catch (err) {
      console.error(`[boot] ${err.message}`);
    }
  });

  const st = store.get();
  const token = process.env.DISCORD_TOKEN || st.token;
  if (token) {
    console.log('[boot] token trouvé — reconnexion automatique');
    try {
      await bot.connect(process.env.DISCORD_TOKEN || null, { remember: !!process.env.DISCORD_TOKEN });
    } catch (err) {
      console.error(`[boot] reconnexion impossible : ${err.message}`);
    }
  } else {
    console.log('[boot] aucun token enregistré — connectez le bot depuis le dashboard');
  }

  // Battement de coeur : applique les créneaux et purge les verrous minutés
  setInterval(() => { scheduler.tick().catch(() => {}); }, 30000);

  app.listen(PORT, () => console.log(`🌐 DachGuard sur http://localhost:${PORT}${BASE_PATH}`));
}

boot();

module.exports = app;
