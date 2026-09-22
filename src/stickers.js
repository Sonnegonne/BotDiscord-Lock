// ─────────────────────────────────────────────────────────────────────────────
// stickers.js — la garde anti-stickers
// Discord n'a pas de permission « interdire les stickers » : la seule qui
// existe (UseExternalStickers) ne couvre que ceux venant d'autres serveurs.
// DachGuard applique donc la règle à la réception : tout message porteur d'un
// sticker est effacé, sauf exception. La décision est isolée ici pour pouvoir
// être testée sans connexion (voir test/sticker-check.js).
// ─────────────────────────────────────────────────────────────────────────────
const { PermissionsBitField } = require('discord.js');

// Chargement différé : store.js lit nos valeurs par défaut dès son initialisation,
// un require en tête de fichier ferait une boucle et renverrait un module vide.
const store = () => require('./store');

function defaults() {
  return {
    enabled: false,
    exemptChannelIds: [],   // salons — ou catégories — où les stickers restent permis
    exemptRoleIds: [],      // rôles autorisés malgré tout (profs, délégués…)
    allowStaff: true,       // « Gérer les messages » passe outre
    allowBots: true,        // ne pas se battre avec les autres bots
    warn: true,             // prévenir l'auteur dans le salon
    warnMessage: 'Les stickers ne sont pas autorisés ici.',
    warnSeconds: 10,        // le rappel s'efface tout seul après ce délai
  };
}

function rules() {
  return { ...defaults(), ...(store().get().settings.stickerGuard || {}) };
}

// ─── La décision, sans Discord ──────────────────────────────────────────────
// msg : { hasSticker, isBot, channelIds[], authorRoleIds[], canManageMessages }
// `channelIds` = le salon, sa catégorie, et le salon parent d'un fil.
function decide(msg, r = rules()) {
  if (!r.enabled) return { remove: false, reason: 'garde désactivée' };
  if (!msg.hasSticker) return { remove: false, reason: 'pas de sticker' };
  if (msg.isBot && r.allowBots) return { remove: false, reason: 'message d un bot' };

  const exemptChannel = (msg.channelIds || []).find(id => id && r.exemptChannelIds.includes(id));
  if (exemptChannel) return { remove: false, reason: 'salon autorisé' };

  if (r.allowStaff && msg.canManageMessages) return { remove: false, reason: 'modération' };

  const exemptRole = (msg.authorRoleIds || []).find(id => r.exemptRoleIds.includes(id));
  if (exemptRole) return { remove: false, reason: 'rôle autorisé', roleId: exemptRole };

  return { remove: true, reason: 'sticker interdit' };
}

// ─── Lecture d'un vrai message Discord ──────────────────────────────────────
function describe(message) {
  const ch = message.channel;
  const channelIds = [ch?.id, ch?.parentId, ch?.parent?.parentId].filter(Boolean);
  let canManageMessages = false;
  try {
    canManageMessages = message.member
      ? (ch?.permissionsFor(message.member)?.has(PermissionsBitField.Flags.ManageMessages) ?? false)
      : false;
  } catch (e) { /* salon sans permissions calculables */ }

  return {
    hasSticker: (message.stickers?.size || 0) > 0,
    isBot: !!message.author?.bot,
    channelIds,
    authorRoleIds: message.member ? [...message.member.roles.cache.keys()] : [],
    canManageMessages,
  };
}

// ─── Rappel à l'ordre, effacé peu après ─────────────────────────────────────
const lastWarn = new Map();   // salonId:auteurId -> horodatage

function shouldWarn(channelId, userId, now = Date.now()) {
  const key = `${channelId}:${userId}`;
  const prev = lastWarn.get(key) || 0;
  if (now - prev < 30000) return false;
  lastWarn.set(key, now);
  return true;
}

async function warnAuthor(message, r) {
  if (!r.warn) return;
  if (!shouldWarn(message.channel.id, message.author.id)) return;
  try {
    const sent = await message.channel.send({
      content: `${message.author} ${r.warnMessage}`,
      allowedMentions: { users: [message.author.id] },
    });
    const delay = Math.max(3, Number(r.warnSeconds) || 10) * 1000;
    setTimeout(() => sent.delete().catch(() => {}), delay);
  } catch (e) { /* pas le droit d'écrire ici : tant pis, le sticker est parti */ }
}

// ─── Statistiques, pour le dashboard ────────────────────────────────────────
function stats() {
  const st = store().get();
  if (!st.stickerStats) st.stickerStats = { removed: 0, lastAt: null, lastUser: null, lastChannel: null, lastError: null };
  return st.stickerStats;
}

// ─── Le point d'entrée appelé sur chaque message ────────────────────────────
// Renvoie ce qui a été fait, pour les tests et le journal.
async function handle(message, { onChange } = {}) {
  if (!message || !message.guild) return { removed: false, reason: 'hors serveur' };
  const r = rules();
  const verdict = decide(describe(message), r);
  if (!verdict.remove) return { removed: false, reason: verdict.reason };

  const names = [...message.stickers.values()].map(s => s.name).join(', ');
  const st = stats();

  try {
    await message.delete();
  } catch (err) {
    st.lastError = err.message;
    store().logActivity({
      type: 'error', source: 'stickers',
      label: 'suppression impossible',
      detail: `#${message.channel.name} — ${err.message}`,
    });
    console.warn(`[stickers] suppression impossible dans #${message.channel?.name}: ${err.message}`);
    if (onChange) onChange();
    return { removed: false, reason: 'échec', error: err.message };
  }

  st.removed = (st.removed || 0) + 1;
  st.lastAt = new Date().toISOString();
  st.lastUser = message.author?.tag || message.author?.username || null;
  st.lastChannel = message.channel?.name || null;
  st.lastError = null;

  store().logActivity({
    type: 'sticker', source: 'auto',
    label: message.author?.tag || 'membre',
    detail: `#${message.channel.name}${names ? ` — « ${names} »` : ''}`,
  });

  await warnAuthor(message, r);
  if (onChange) onChange();
  return { removed: true, sticker: names };
}

// L'appoint côté Discord : sans cette permission sur @everyone, les stickers
// des autres serveurs n'arrivent même pas jusqu'au bot.
function everyoneCanUseExternal(guild) {
  try {
    return guild.roles.everyone.permissions.has(PermissionsBitField.Flags.UseExternalStickers);
  } catch (e) { return null; }
}

module.exports = { defaults, rules, decide, describe, handle, stats, everyoneCanUseExternal, shouldWarn };
