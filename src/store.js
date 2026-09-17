// ─────────────────────────────────────────────────────────────────────────────
// store.js — état persistant de DachGuard
// Tout ce que le bot sait (token, classes, planifications, verrous en cours,
// snapshots de permissions, journal) vit dans data/state.json et survit donc
// à un redémarrage PM2. Écriture atomique + debounce.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'state.json');
const TMP = FILE + '.tmp';

const SCHEMA_VERSION = 2;

function defaults() {
  return {
    schemaVersion: SCHEMA_VERSION,
    token: null,                 // token du bot, pour la reconnexion auto
    guildId: null,
    settings: {
      timezone: 'Europe/Brussels',
      strictLock: true,          // bloque aussi fils de discussion + réactions
      announceLock: true,        // poste un encart dans le salon verrouillé
      announceUnlock: true,      // poste un « c'est rouvert » éphémère
      defaultLockMessage: 'Salon fermé — on se retrouve à la réouverture.',
      protectedChannelIds: [],   // jamais touchés par les actions globales
      slashCommands: true,
    },
    groups: [],                  // les classes (3TIN, 4TIN, …)
    schedules: [],
    locks: {},                   // channelId -> { channelName, parentName, messageId, roles:{} }
    snapshots: {},               // channelId -> roleId -> { existed, allow, deny }
    activity: [],                // journal, plus récent en premier
  };
}

let state = defaults();
let saveTimer = null;
let writing = false;
let dirtyWhileWriting = false;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

function load() {
  ensureDir();
  try {
    if (fs.existsSync(FILE)) {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      state = migrate({ ...defaults(), ...raw, settings: { ...defaults().settings, ...(raw.settings || {}) } });
      console.log(`[store] état chargé (${state.groups.length} classe(s), ${state.schedules.length} planification(s))`);
    } else {
      console.log('[store] aucun état existant, démarrage à neuf');
      save(true);
    }
  } catch (err) {
    console.error(`[store] état illisible (${err.message}) — sauvegarde en .corrupt et repart à neuf`);
    try { fs.renameSync(FILE, FILE + '.corrupt-' + Date.now()); } catch (e) {}
    state = defaults();
  }
  return state;
}

function migrate(s) {
  s.schemaVersion = SCHEMA_VERSION;
  return s;
}

function writeNow() {
  ensureDir();
  writing = true;
  try {
    fs.writeFileSync(TMP, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(TMP, FILE);
    try { fs.chmodSync(FILE, 0o600); } catch (e) {}
  } catch (err) {
    console.error(`[store] échec d'écriture: ${err.message}`);
  } finally {
    writing = false;
    if (dirtyWhileWriting) { dirtyWhileWriting = false; save(); }
  }
}

function save(immediate = false) {
  if (writing) { dirtyWhileWriting = true; return; }
  if (immediate) { clearTimeout(saveTimer); saveTimer = null; return writeNow(); }
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; writeNow(); }, 250);
}

function get() { return state; }

// ─── Journal ────────────────────────────────────────────────────────────────
const MAX_ACTIVITY = 250;

function logActivity(entry) {
  state.activity.unshift({ at: new Date().toISOString(), ...entry });
  if (state.activity.length > MAX_ACTIVITY) state.activity.length = MAX_ACTIVITY;
  save();
  return state.activity[0];
}

process.on('SIGINT', () => { save(true); process.exit(0); });
process.on('SIGTERM', () => { save(true); process.exit(0); });

module.exports = { load, save, get, logActivity, FILE, DATA_DIR };
