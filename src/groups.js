// ─────────────────────────────────────────────────────────────────────────────
// groups.js — les « classes » : un nom, des rôles, des salons.
// Une classe est l unité de travail de DachGuard : on verrouille une classe,
// on planifie pour une classe, on met une classe en pause.
// ─────────────────────────────────────────────────────────────────────────────
const store = require('./store');
const bot = require('./bot');

const PALETTE = ['#5865F2', '#2ecc71', '#e67e22', '#9b59b6', '#e91e63', '#1abc9c', '#f1c40f'];

function s() { return store.get(); }

function normalize(str) {
  return (str || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

function newId(name) {
  const base = normalize(name).slice(0, 24) || 'classe';
  let id = base, n = 2;
  while (s().groups.some(g => g.id === id)) id = `${base}${n++}`;
  return id;
}

function list() { return s().groups; }

function find(id) {
  const g = s().groups.find(x => x.id === id);
  if (!g) throw new Error('Classe introuvable');
  return g;
}

function sanitize(data, existing) {
  const g = existing || {};
  return {
    id: g.id,
    name: (data.name !== undefined ? String(data.name).trim() : g.name) || 'Sans nom',
    emoji: data.emoji !== undefined ? String(data.emoji).trim().slice(0, 4) : (g.emoji || ''),
    color: data.color !== undefined ? String(data.color) : (g.color || PALETTE[0]),
    roleIds: data.roleIds !== undefined ? [...new Set(data.roleIds)] : (g.roleIds || []),
    channelIds: data.channelIds !== undefined ? [...new Set(data.channelIds)] : (g.channelIds || []),
    enabled: data.enabled !== undefined ? !!data.enabled : (g.enabled !== false),
    defaultMessage: data.defaultMessage !== undefined ? String(data.defaultMessage) : (g.defaultMessage || ''),
    createdAt: g.createdAt || new Date().toISOString(),
  };
}

function create(data) {
  const st = s();
  const group = sanitize(data);
  group.id = newId(group.name);
  if (!data.color) group.color = PALETTE[st.groups.length % PALETTE.length];
  st.groups.push(group);
  store.save(true);
  bot.registerSlashCommands().catch(() => {});
  return group;
}

function update(id, data) {
  const st = s();
  const idx = st.groups.findIndex(g => g.id === id);
  if (idx === -1) throw new Error('Classe introuvable');
  st.groups[idx] = sanitize(data, st.groups[idx]);
  store.save(true);
  bot.registerSlashCommands().catch(() => {});
  return st.groups[idx];
}

function remove(id) {
  const st = s();
  const idx = st.groups.findIndex(g => g.id === id);
  if (idx === -1) throw new Error('Classe introuvable');
  st.groups.splice(idx, 1);
  // les planifications orphelines repassent en « sans classe »
  st.schedules.forEach(sc => { if (sc.groupId === id) sc.groupId = null; });
  store.save(true);
  bot.registerSlashCommands().catch(() => {});
  return true;
}

function toggle(id) {
  const g = find(id);
  g.enabled = !g.enabled;
  store.save(true);
  return g;
}

// ─── Détection automatique ──────────────────────────────────────────────────
// Reconnaît « 3TIN », « 4TTI », « 3ème », « (4eme) » dans les noms de rôles,
// de salons et de catégories, et en déduit une classe par niveau.
const LEVEL_RE = /(\d)\s*(?:t\s*(?:in|ti|tin|tti)|eme|e)\b/;

function levelOf(raw) {
  const n = normalize(raw);
  let m = n.match(/([2-7])t(?:in|ti|tin|tti)/);
  if (m) return m[1];
  m = n.match(/([2-7])(?:eme|e)(?![a-z0-9])/);
  if (m) return m[1];
  return null;
}

function detect() {
  const { channels, roles } = bot.status();
  const found = {};

  for (const r of roles) {
    const lvl = levelOf(r.name);
    if (!lvl) continue;
    if (!found[lvl]) found[lvl] = { level: lvl, roles: [], channels: [] };
    found[lvl].roles.push(r);
  }
  for (const c of channels) {
    const lvl = levelOf(c.name) || levelOf(c.parentName);
    if (!lvl) continue;
    if (!found[lvl]) found[lvl] = { level: lvl, roles: [], channels: [] };
    found[lvl].channels.push(c);
  }

  const st = s();
  return Object.values(found)
    .sort((a, b) => a.level.localeCompare(b.level))
    .map((f, i) => {
      // le rôle « principal » = le plus court (3TIN plutôt que « Non vérifié 3TIN »)
      const main = [...f.roles].sort((a, b) => a.name.length - b.name.length)[0];
      const name = main ? main.name : `${f.level}ème`;
      const existing = st.groups.find(g => normalize(g.name) === normalize(name));
      return {
        level: f.level,
        id: existing ? existing.id : null,
        name,
        emoji: f.level === '3' ? '💽' : f.level === '4' ? '💻' : '🎓',
        color: (main && main.color !== '#99aab5') ? main.color : PALETTE[i % PALETTE.length],
        roleIds: main ? [main.id] : [],
        suggestedRoleIds: f.roles.map(r => r.id),
        channelIds: f.channels.map(c => c.id),
        roles: f.roles,
        channels: f.channels,
      };
    });
}

function applyDetection(selection) {
  const proposals = detect();
  const applied = [];
  for (const p of proposals) {
    if (selection && selection.length && !selection.includes(p.level)) continue;
    const payload = {
      name: p.name, emoji: p.emoji, color: p.color,
      roleIds: p.roleIds, channelIds: p.channelIds,
    };
    applied.push(p.id ? update(p.id, payload) : create(payload));
  }
  return applied;
}

// Première mise en route : crée les classes et protège les salons sensibles.
function seed() {
  const st = s();
  let changed = false;
  if (!st.groups.length) {
    const made = applyDetection();
    changed = made.length > 0;
    if (changed) console.log(`[classes] détection automatique : ${made.map(g => g.name).join(', ')}`);
  }
  if (!st.settings.protectedChannelIds.length) {
    const { channels } = bot.status();
    const prot = channels
      .filter(c => bot.PROTECT_KEYWORDS.some(k => normalize(c.parentName).includes(k) || normalize(c.name).includes(k)))
      .map(c => c.id);
    if (prot.length) {
      st.settings.protectedChannelIds = prot;
      changed = true;
      console.log(`[classes] ${prot.length} salon(s) sensibles protégés automatiquement`);
    }
  }
  if (changed) store.save(true);
}

module.exports = { list, find, create, update, remove, toggle, detect, applyDetection, seed, normalize, levelOf };
