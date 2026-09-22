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
  const g = groups.find(req.params.id);
  if (!g.channelIds.length) throw new Error(`Aucun salon configuré pour ${g.name}`);
  if (!g.roleIds.length) throw new Error(`Aucun rôle configuré pour ${g.name}`);
  const { message, durationMinutes, mode } = req.body || {};
  return summarize(await bot.lock(g.channelIds, g.roleIds, {
    message: message !== undefined ? message : (g.defaultMessage || undefined),
    durationMinutes, mode, groupId: g.id, source: 'dashboard', label: g.name,
  }));
}));

app.post(`${BASE_PATH}/api/groups/:id/unlock`, route(async (req) => {
  const g = groups.find(req.params.id);
  return summarize(await bot.unlock(g.channelIds, g.roleIds, {
    restore: (req.body && req.body.restore) || 'restore', source: 'dashboard', label: g.name,
  }));
}));

// Tout fermer / tout rouvrir
app.post(`${BASE_PATH}/api/panic`, route(async (req) => {
  const st = store.get();
  const { channels } = bot.status();
  const protectedIds = new Set(st.settings.protectedChannelIds);
  const channelIds = channels.filter(c => !protectedIds.has(c.id)).map(c => c.id);
  const roleIds = [...new Set(st.groups.flatMap(g => g.roleIds))];
  if (!roleIds.length) throw new Error('Configurez au moins une classe avec un rôle');
  return summarize(await bot.lock(channelIds, roleIds, {
    message: (req.body && req.body.message) || undefined,
    durationMinutes: (req.body && req.body.durationMinutes) || null,
    source: 'dashboard', label: 'fermeture générale',
  }));
}));

app.post(`${BASE_PATH}/api/release-all`, route(async (req) => {
  const st = store.get();
  const channelIds = Object.keys(st.locks);
  if (!channelIds.length) return { success: true, ok: 0, total: 0, results: [], errors: [] };
  return summarize(await bot.unlock(channelIds, [], {
    restore: (req.body && req.body.restore) || 'restore', source: 'dashboard', label: 'réouverture générale',
  }));
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
