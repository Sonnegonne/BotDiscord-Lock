// ─────────────────────────────────────────────────────────────────────────────
// scheduler.js — planifications hebdomadaires
// Nouveautés : plusieurs jours par planification, créneaux qui passent minuit,
// ciblage par classe, et surtout une RÉCONCILIATION au démarrage : après un
// redémarrage en plein créneau, le bot rattrape le verrou au lieu de l oublier.
// ─────────────────────────────────────────────────────────────────────────────
const store = require('./store');
const bot = require('./bot');

const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const DAY_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function s() { return store.get(); }
function tz() { return s().settings.timezone || 'Europe/Brussels'; }

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Heure locale du fuseau configuré, sans dépendance externe
function zonedNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz(), weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = t => parts.find(p => p.type === t).value;
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { day: map[get('weekday')], minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function isOvernight(schedule) {
  return toMinutes(schedule.endTime) <= toMinutes(schedule.startTime);
}

// Le créneau est-il en cours maintenant ?
function isWithinWindow(schedule, now = new Date()) {
  const { day, minutes } = zonedNow(now);
  const start = toMinutes(schedule.startTime);
  const end = toMinutes(schedule.endTime);
  const days = schedule.days || [];
  if (!isOvernight(schedule)) {
    return days.includes(day) && minutes >= start && minutes < end;
  }
  // créneau à cheval sur minuit : soir du jour J, ou matin du jour J+1
  if (days.includes(day) && minutes >= start) return true;
  const prev = (day + 6) % 7;
  return days.includes(prev) && minutes < end;
}

// ─── Cibles ─────────────────────────────────────────────────────────────────
function resolveTargets(schedule) {
  const st = s();
  const group = schedule.groupId ? st.groups.find(g => g.id === schedule.groupId) : null;
  const channelIds = (schedule.channelIds && schedule.channelIds.length)
    ? schedule.channelIds : (group ? group.channelIds : []);
  const roleIds = (schedule.roleIds && schedule.roleIds.length)
    ? schedule.roleIds : (group ? group.roleIds : []);
  return { channelIds, roleIds, group };
}

function isEffectivelyActive(schedule) {
  if (!schedule.active) return false;
  if (schedule.groupId) {
    const g = s().groups.find(x => x.id === schedule.groupId);
    if (g && g.enabled === false) return false;
  }
  return true;
}

// ─── Validation ─────────────────────────────────────────────────────────────
function sanitize(data, existing) {
  const e = existing || {};
  const days = data.days !== undefined
    ? [...new Set(data.days.map(Number))].filter(d => d >= 0 && d <= 6).sort()
    : (e.days || []);
  const sc = {
    id: e.id,
    name: data.name !== undefined ? String(data.name).trim() : (e.name || ''),
    groupId: data.groupId !== undefined ? (data.groupId || null) : (e.groupId || null),
    days,
    startTime: data.startTime !== undefined ? String(data.startTime) : e.startTime,
    endTime: data.endTime !== undefined ? String(data.endTime) : e.endTime,
    channelIds: data.channelIds !== undefined ? [...new Set(data.channelIds)] : (e.channelIds || []),
    roleIds: data.roleIds !== undefined ? [...new Set(data.roleIds)] : (e.roleIds || []),
    mode: data.mode !== undefined ? data.mode : (e.mode || 'auto'),
    lockMessage: data.lockMessage !== undefined
      ? (String(data.lockMessage).trim() || null) : (e.lockMessage !== undefined ? e.lockMessage : null),
    active: data.active !== undefined ? !!data.active : (e.active !== false),
    createdAt: e.createdAt || new Date().toISOString(),
    lastLocked: e.lastLocked || null,
    lastUnlocked: e.lastUnlocked || null,
  };

  if (!sc.days.length) throw new Error('Choisissez au moins un jour');
  if (!/^\d{1,2}:\d{2}$/.test(sc.startTime || '') || !/^\d{1,2}:\d{2}$/.test(sc.endTime || '')) {
    throw new Error('Heures invalides');
  }
  if (toMinutes(sc.startTime) === toMinutes(sc.endTime)) {
    throw new Error('Les heures de fermeture et de réouverture sont identiques');
  }
  const t = resolveTargets(sc);
  if (!t.channelIds.length) throw new Error('Aucun salon ciblé (choisissez une classe ou des salons)');
  if (!t.roleIds.length) throw new Error('Aucun rôle ciblé (choisissez une classe ou des rôles)');
  if (!sc.name) {
    const g = t.group;
    sc.name = `${g ? g.name + ' — ' : ''}${sc.startTime} à ${sc.endTime}`;
  }
  return sc;
}

// ─── CRUD ───────────────────────────────────────────────────────────────────
function list() {
  return s().schedules.map(sc => ({
    ...sc,
    effectiveActive: isEffectivelyActive(sc),
    running: isWithinWindow(sc),
    overnight: isOvernight(sc),
    nextRun: nextRunOf(sc),
    targets: resolveTargets(sc),
  }));
}

function create(data) {
  const st = s();
  const sc = sanitize(data);
  sc.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  st.schedules.push(sc);
  register(sc);
  store.save(true);
  store.logActivity({ type: 'schedule', source: 'dashboard', label: `Planification créée : ${sc.name}` });
  return sc;
}

function update(id, data) {
  const st = s();
  const idx = st.schedules.findIndex(x => x.id === id);
  if (idx === -1) throw new Error('Planification introuvable');
  const sc = sanitize(data, st.schedules[idx]);
  sc.id = id;
  st.schedules[idx] = sc;
  register(sc);
  store.save(true);
  return sc;
}

function remove(id) {
  const st = s();
  const idx = st.schedules.findIndex(x => x.id === id);
  if (idx === -1) throw new Error('Planification introuvable');
  const removed = st.schedules.splice(idx, 1)[0];
  unregister(id);
  store.save(true);
  store.logActivity({ type: 'schedule', source: 'dashboard', label: `Planification supprimée : ${removed.name}` });
  return true;
}

function toggle(id) {
  const st = s();
  const sc = st.schedules.find(x => x.id === id);
  if (!sc) throw new Error('Planification introuvable');
  sc.active = !sc.active;
  register(sc);
  store.save(true);
  return sc;
}

// Rebranche tous les jobs d une classe (utile quand on la met en pause)
function refreshGroup(groupId) {
  s().schedules.filter(sc => sc.groupId === groupId).forEach(register);
}

// ─── Calcul des prochaines échéances ────────────────────────────────────────
// Pas de cron : l état voulu se recalcule à chaque tick à partir des créneaux.
// Une seule source de vérité, qui survit aux redémarrages et aux heures d été.

// Décalage du fuseau (en minutes) à un instant donné
function tzOffset(instant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUTC - Math.floor(instant.getTime() / 1000) * 1000) / 60000;
}

function zonedYMD(instant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(instant);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { y: +p.year, m: +p.month, d: +p.day, weekday: map[p.weekday] };
}

// Heure murale (dans le fuseau) -> instant réel
function wallClockToInstant(y, m, d, minutes) {
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  let t = guess - tzOffset(new Date(guess)) * 60000;
  const corrected = guess - tzOffset(new Date(t)) * 60000;   // bord d heure d été
  return new Date(corrected);
}

function nextOccurrence(days, hhmm, from = new Date()) {
  if (!days || !days.length) return null;
  const minutes = toMinutes(hhmm);
  for (let i = 0; i <= 8; i++) {
    const probe = new Date(from.getTime() + i * 86400000);
    const { y, m, d, weekday } = zonedYMD(probe);
    if (!days.includes(weekday)) continue;
    const at = wallClockToInstant(y, m, d, minutes);
    if (at > from) return at;
  }
  return null;
}

function nextRunOf(schedule) {
  if (!isEffectivelyActive(schedule)) return null;
  const unlockDays = isOvernight(schedule)
    ? [...new Set(schedule.days.map(d => (d + 1) % 7))].sort()
    : schedule.days;
  const candidates = [
    { at: nextOccurrence(schedule.days, schedule.startTime), kind: 'lock' },
    { at: nextOccurrence(unlockDays, schedule.endTime), kind: 'unlock' },
  ].filter(c => c.at);
  if (!candidates.length) return null;
  const next = candidates.sort((a, b) => a.at - b.at)[0];
  return { at: next.at.toISOString(), kind: next.kind };
}

// Conservés pour compatibilité : le tick fait tout le travail
function register() {}
function unregister() {}
function registerAll() {
  const n = s().schedules.filter(isEffectivelyActive).length;
  console.log(`[planning] ${n} planification(s) active(s) — fuseau ${tz()}`);
}

// ─── Réconciliation ─────────────────────────────────────────────────────────
// Remet le monde d aplomb : verrouille ce qui devrait l être, rouvre ce qui
// ne devrait plus l être. Appelée à chaque connexion du bot.
async function reconcile() {
  const st = s();
  if (!bot.isReady()) return { locked: 0, unlocked: 0 };
  let locked = 0, unlocked = 0;

  for (const sc of st.schedules) {
    const { channelIds, roleIds } = resolveTargets(sc);
    if (!channelIds.length || !roleIds.length) continue;
    const shouldLock = isEffectivelyActive(sc) && isWithinWindow(sc);

    const missing = new Set();
    const stale = new Set();
    for (const channelId of channelIds) {
      const entry = st.locks[channelId];
      for (const roleId of roleIds) {
        const held = entry && entry.roles[roleId];
        if (shouldLock && !held) missing.add(channelId);
        if (!shouldLock && held && held.scheduleId === sc.id) stale.add(channelId);
      }
    }

    if (shouldLock && missing.size) {
      try {
        await bot.lock([...missing], roleIds, {
          message: sc.lockMessage === null ? undefined : sc.lockMessage,
          mode: sc.mode, groupId: sc.groupId, scheduleId: sc.id,
          source: 'planification', label: sc.name,
        });
        sc.lastLocked = new Date().toISOString();
        locked += missing.size;
      } catch (err) {
        console.error(`[planning] verrouillage "${sc.name}" : ${err.message}`);
        store.logActivity({ type: 'error', source: 'planification', label: sc.name, detail: err.message });
      }
    }
    if (!shouldLock && stale.size) {
      try {
        await bot.unlock([...stale], roleIds, {
          restore: 'restore', source: 'planification', label: sc.name,
        });
        sc.lastUnlocked = new Date().toISOString();
        unlocked += stale.size;
      } catch (err) {
        console.error(`[planning] réouverture "${sc.name}" : ${err.message}`);
        store.logActivity({ type: 'error', source: 'planification', label: sc.name, detail: err.message });
      }
    }
  }

  if (locked || unlocked) {
    store.save();
    console.log(`[planning] ${locked} salon(s) verrouillé(s), ${unlocked} rouvert(s)`);
  }
  return { locked, unlocked };
}

// Le battement de coeur : réconcilie les créneaux puis purge les minuteurs.
let ticking = false;
async function tick() {
  if (ticking || !bot.isReady()) return;
  ticking = true;
  try {
    await reconcile();
    await bot.sweepExpired();
  } catch (err) {
    console.error(`[tick] ${err.message}`);
  } finally {
    ticking = false;
  }
}

module.exports = {
  list, create, update, remove, toggle, register, registerAll, unregister,
  reconcile, tick, refreshGroup, isWithinWindow, isOvernight, resolveTargets,
  nextRunOf, nextOccurrence, zonedNow, toMinutes, DAY_NAMES, DAY_SHORT,
};
