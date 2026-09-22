// ─────────────────────────────────────────────────────────────────────────────
// bot.js — connexion Discord et moteur de verrouillage
// ─────────────────────────────────────────────────────────────────────────────
const EventEmitter = require('events');
const {
  Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder,
  SlashCommandBuilder, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const store = require('./store');
const stickers = require('./stickers');
const {
  LOCKABLE_TYPES, kindOf, lockedPerms, clearPerms, allowPerms,
  snapshotToOptions, bypassKeys,
} = require('./permissions');

const bus = new EventEmitter();

let client = null;
let ready = false;
let lastError = null;
let connectedAt = null;
let guildCache = { guild: null, channels: [], roles: [], categories: [] };
let slashStatus = { ok: false, reason: 'pas encore tenté' };

const TICKET_KEYWORDS = ['ticket', 'tickets'];
const PROTECT_KEYWORDS = ['mod', 'log', 'ticket', 'arriv', 'sanction', 'tribunal'];

// ─── Helpers ────────────────────────────────────────────────────────────────
function s() { return store.get(); }

function getGuild() {
  if (!client || !ready) return null;
  const st = s();
  if (st.guildId) {
    const g = client.guilds.cache.get(st.guildId);
    if (g) return g;
  }
  return client.guilds.cache.first() || null;
}

function requireGuild() {
  if (!client || !ready) throw new Error('Bot non connecté à Discord');
  const g = getGuild();
  if (!g) throw new Error('Aucun serveur Discord accessible');
  return g;
}

function isTicketChannel(channel) {
  const parent = channel.parent || channel.guild?.channels.cache.get(channel.parentId);
  const name = `${parent?.name || ''} ${channel.name}`.toLowerCase();
  return TICKET_KEYWORDS.some(k => name.includes(k));
}

function resolveMode(channel, mode) {
  if (mode && mode !== 'auto') return mode;
  return isTicketChannel(channel) ? 'hide' : 'write';
}

// ─── Lecture du serveur ─────────────────────────────────────────────────────
function refresh() {
  const guild = getGuild();
  if (!guild) return guildCache;

  const st = s();
  if (st.guildId !== guild.id) { st.guildId = guild.id; store.save(); }

  const categories = guild.channels.cache
    .filter(c => c.type === 4)
    .map(c => ({ id: c.id, name: c.name, position: c.rawPosition }))
    .sort((a, b) => a.position - b.position);

  const channels = guild.channels.cache
    .filter(c => LOCKABLE_TYPES.includes(c.type))
    .map(c => ({
      id: c.id,
      name: c.name,
      kind: kindOf(c.type),
      parentId: c.parentId || null,
      parentName: c.parent?.name || 'Sans catégorie',
      parentPosition: c.parent?.rawPosition ?? 999,
      position: c.rawPosition,
      isTicket: isTicketChannel(c),
      protected: st.settings.protectedChannelIds.includes(c.id),
    }))
    .sort((a, b) => a.parentPosition - b.parentPosition || a.position - b.position);

  const me = guild.members.me;
  const roles = guild.roles.cache
    .filter(r => r.name !== '@everyone' && !r.managed)
    .map(r => ({
      id: r.id,
      name: r.name,
      color: r.hexColor === '#000000' ? '#99aab5' : r.hexColor,
      position: r.position,
      admin: r.permissions.has(PermissionsBitField.Flags.Administrator),
      manageable: me ? r.position < me.roles.highest.position : true,
    }))
    .sort((a, b) => b.position - a.position);

  guildCache = {
    guild: {
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL({ size: 128 }),
      memberCount: guild.memberCount,
      botTag: client.user?.tag || null,
      botRolePosition: me?.roles.highest.position ?? null,
      canManageRoles: me?.permissions.has(PermissionsBitField.Flags.ManageRoles) ?? false,
      canManageMessages: me?.permissions.has(PermissionsBitField.Flags.ManageMessages) ?? false,
      everyoneCanUseExternalStickers: stickers.everyoneCanUseExternal(guild),
    },
    channels, roles, categories,
  };
  return guildCache;
}

// ─── Snapshots ──────────────────────────────────────────────────────────────
function snapshot(channel, roleId) {
  const st = s();
  if (!st.snapshots[channel.id]) st.snapshots[channel.id] = {};
  // Ne jamais écraser un snapshot existant : le premier pris est le bon
  if (st.snapshots[channel.id][roleId]) return;
  const existing = channel.permissionOverwrites.cache.get(roleId);
  st.snapshots[channel.id][roleId] = existing
    ? { existed: true, allow: existing.allow.bitfield.toString(), deny: existing.deny.bitfield.toString() }
    : { existed: false };
  store.save();
}

// ─── Encart de verrouillage ─────────────────────────────────────────────────
function lockEmbed({ message, until, groupName, roleNames }) {
  const e = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('🔒 Salon verrouillé')
    .setDescription(message || s().settings.defaultLockMessage);
  const fields = [];
  if (groupName) fields.push({ name: 'Concerne', value: groupName, inline: true });
  else if (roleNames && roleNames.length) fields.push({ name: 'Concerne', value: roleNames.map(r => '@' + r).join(', ').slice(0, 900), inline: true });
  if (until) fields.push({ name: 'Réouverture', value: `<t:${Math.floor(new Date(until).getTime() / 1000)}:t>`, inline: true });
  if (fields.length) e.addFields(fields);
  e.setFooter({ text: 'DachGuard' }).setTimestamp();
  return e;
}

async function postLockNotice(channel, opts) {
  if (!s().settings.announceLock) return null;
  if (opts.message === '') return null;          // message vide = pas d encart
  try {
    const msg = await channel.send({ embeds: [lockEmbed(opts)] });
    return msg.id;
  } catch (err) {
    console.warn(`[lock] encart impossible dans #${channel.name}: ${err.message}`);
    return null;
  }
}

async function removeLockNotice(channel, messageId) {
  if (!messageId) return;
  try {
    const msg = await channel.messages.fetch(messageId);
    if (msg) await msg.delete();
  } catch (e) { /* déjà supprimé */ }
}

async function postUnlockNotice(channel) {
  if (!s().settings.announceUnlock) return;
  try {
    const e = new EmbedBuilder().setColor(0x57f287).setTitle('🔓 Salon rouvert')
      .setDescription('Vous pouvez à nouveau écrire ici.').setFooter({ text: 'DachGuard' });
    const msg = await channel.send({ embeds: [e] });
    setTimeout(() => msg.delete().catch(() => {}), 60000);
  } catch (e) { /* ignore */ }
}

// ─── VERROUILLAGE ───────────────────────────────────────────────────────────
async function lock(channelIds, roleIds, opts = {}) {
  const guild = requireGuild();
  const st = s();
  const roles = [...new Set(roleIds)].filter(Boolean);
  if (!roles.length) throw new Error('Aucun rôle ciblé');

  const until = opts.durationMinutes
    ? new Date(Date.now() + Number(opts.durationMinutes) * 60000).toISOString()
    : (opts.until || null);

  const group = opts.groupId ? st.groups.find(g => g.id === opts.groupId) : null;
  const roleNames = roles.map(id => guild.roles.cache.get(id)?.name).filter(Boolean);
  const results = [];

  for (const channelId of [...new Set(channelIds)]) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) { results.push({ channelId, ok: false, error: 'Salon introuvable' }); continue; }
    if (!LOCKABLE_TYPES.includes(channel.type)) { results.push({ channelId, ok: false, error: 'Type de salon non géré' }); continue; }

    const mode = resolveMode(channel, opts.mode);
    const perms = lockedPerms(kindOf(channel.type), mode, st.settings.strictLock);
    let failed = null;

    for (const roleId of roles) {
      try {
        snapshot(channel, roleId);
        await channel.permissionOverwrites.edit(roleId, perms, { reason: `DachGuard — verrouillage (${opts.source || 'manuel'})` });
      } catch (err) { failed = err.message; }
    }

    if (failed) { results.push({ channelId, name: channel.name, ok: false, error: failed }); continue; }

    const entry = st.locks[channelId] || {
      channelName: channel.name,
      parentName: channel.parent?.name || 'Sans catégorie',
      messageId: null,
      roles: {},
    };
    entry.channelName = channel.name;
    entry.parentName = channel.parent?.name || 'Sans catégorie';

    if (!entry.messageId && mode !== 'hide') {
      entry.messageId = await postLockNotice(channel, {
        message: opts.message,
        until,
        groupName: group ? `${group.emoji || ''} ${group.name}`.trim() : null,
        roleNames,
      });
    }
    for (const roleId of roles) {
      entry.roles[roleId] = {
        lockedAt: new Date().toISOString(),
        mode, until,
        source: opts.source || 'manuel',
        scheduleId: opts.scheduleId || null,
        groupId: opts.groupId || null,
      };
    }
    st.locks[channelId] = entry;
    results.push({ channelId, name: channel.name, ok: true, mode });
  }

  store.save();
  const ok = results.filter(r => r.ok).length;
  if (ok) {
    store.logActivity({
      type: 'lock',
      source: opts.source || 'manuel',
      label: opts.label || (group ? group.name : roleNames.join(', ')),
      count: ok, total: results.length,
      detail: results.filter(r => r.ok).map(r => r.name).join(', '),
      until,
    });
  }
  bus.emit('change');
  return results;
}

async function unlock(channelIds, roleIds, opts = {}) {
  const guild = requireGuild();
  const st = s();
  const mode = opts.restore === true ? 'restore' : (opts.restore || 'restore');
  const results = [];

  for (const channelId of [...new Set(channelIds)]) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      delete st.locks[channelId]; delete st.snapshots[channelId];
      results.push({ channelId, ok: false, error: 'Salon introuvable' });
      continue;
    }
    const entry = st.locks[channelId];
    const targets = (roleIds && roleIds.length)
      ? [...new Set(roleIds)]
      : Object.keys((entry && entry.roles) || {});
    if (!targets.length) { results.push({ channelId, name: channel.name, ok: true, skipped: true }); continue; }

    let failed = null;
    for (const roleId of targets) {
      try {
        const snap = st.snapshots[channelId] && st.snapshots[channelId][roleId];
        const kind = kindOf(channel.type);
        const lockMode = (entry && entry.roles[roleId] && entry.roles[roleId].mode) || resolveMode(channel, 'auto');

        if (mode === 'allow') {
          await channel.permissionOverwrites.edit(roleId, allowPerms(kind, lockMode), { reason: 'DachGuard — autorisation forcée' });
        } else if (mode === 'restore' && snap) {
          if (!snap.existed) {
            const ow = channel.permissionOverwrites.cache.get(roleId);
            if (ow) await ow.delete('DachGuard — retour a l etat initial');
          } else {
            await channel.permissionOverwrites.edit(roleId, snapshotToOptions(snap), { reason: 'DachGuard — retour a l etat initial' });
          }
        } else {
          await channel.permissionOverwrites.edit(roleId, clearPerms(), { reason: 'DachGuard — deverrouillage' });
          const ow = channel.permissionOverwrites.cache.get(roleId);
          if (ow && ow.allow.bitfield === 0n && ow.deny.bitfield === 0n) await ow.delete('DachGuard — overwrite vide');
        }
        if (st.snapshots[channelId]) delete st.snapshots[channelId][roleId];
        if (entry && entry.roles) delete entry.roles[roleId];
      } catch (err) { failed = err.message; }
    }

    if (entry && Object.keys(entry.roles).length === 0) {
      await removeLockNotice(channel, entry.messageId);
      delete st.locks[channelId];
      if (!opts.silent) await postUnlockNotice(channel);
    }
    if (st.snapshots[channelId] && Object.keys(st.snapshots[channelId]).length === 0) delete st.snapshots[channelId];

    results.push({ channelId, name: channel.name, ok: !failed, error: failed || undefined });
  }

  store.save();
  const ok = results.filter(r => r.ok && !r.skipped).length;
  if (ok) {
    store.logActivity({
      type: 'unlock',
      source: opts.source || 'manuel',
      label: opts.label || (mode === 'restore' ? 'retour a l etat initial' : 'deverrouillage'),
      count: ok, total: results.length,
      detail: results.filter(r => r.ok).map(r => r.name).join(', '),
    });
  }
  bus.emit('change');
  return results;
}

// ─── Diagnostic : qui peut contourner le verrou ? ───────────────────────────
function diagnose(channelIds, roleIds, mode = 'auto') {
  const guild = requireGuild();
  const targeted = new Set(roleIds || []);
  const report = [];

  for (const channelId of channelIds || []) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) continue;
    const kind = kindOf(channel.type);
    const keys = bypassKeys(kind, resolveMode(channel, mode));
    const leaks = [];

    for (const [id, ow] of channel.permissionOverwrites.cache) {
      if (ow.type !== 0) continue;                 // 0 = rôle
      const role = guild.roles.cache.get(id);
      if (!role || targeted.has(id)) continue;
      if (role.id === guild.id) continue;          // @everyone
      if (role.permissions.has(PermissionsBitField.Flags.Administrator)) continue;
      const allowed = keys.some(k => ow.allow.has(PermissionsBitField.Flags[k]));
      if (allowed) leaks.push({ id: role.id, name: role.name, color: role.hexColor });
    }
    if (leaks.length) report.push({ channelId, channelName: channel.name, leaks });
  }

  const admins = guild.roles.cache
    .filter(r => r.permissions.has(PermissionsBitField.Flags.Administrator) && r.name !== '@everyone' && !r.managed)
    .map(r => ({ id: r.id, name: r.name }));

  const me = guild.members.me;
  const unmanageable = (roleIds || [])
    .map(id => guild.roles.cache.get(id))
    .filter(r => r && me && r.position >= me.roles.highest.position)
    .map(r => ({ id: r.id, name: r.name }));

  return { report, admins, unmanageable };
}

// ─── Verrous minutés ────────────────────────────────────────────────────────
async function sweepExpired() {
  if (!ready) return;
  const st = s();
  const now = Date.now();
  for (const [channelId, entry] of Object.entries(st.locks)) {
    const expired = Object.entries(entry.roles)
      .filter(([, r]) => r.until && new Date(r.until).getTime() <= now)
      .map(([roleId]) => roleId);
    if (expired.length) {
      try {
        await unlock([channelId], expired, { restore: 'restore', source: 'minuteur', label: 'fin du minuteur' });
      } catch (err) { console.error(`[minuteur] ${err.message}`); }
    }
  }
}

// ─── Commandes slash ────────────────────────────────────────────────────────
async function registerSlashCommands() {
  const st = s();
  if (!client || !ready) { slashStatus = { ok: false, reason: 'bot non connecté' }; return slashStatus; }
  if (!st.settings.slashCommands) { slashStatus = { ok: false, reason: 'désactivées dans les réglages' }; return slashStatus; }
  const guild = getGuild();
  if (!guild) { slashStatus = { ok: false, reason: 'pas de serveur' }; return slashStatus; }

  const choices = st.groups.slice(0, 25).map(g => ({
    name: `${g.emoji || ''} ${g.name}`.trim().slice(0, 100),
    value: g.id,
  }));

  // Option « classe » : identique dans /lock et /unlock
  const classOption = o => {
    o.setName('classe').setDescription('La classe concernée').setRequired(choices.length > 0);
    if (choices.length) o.addChoices(...choices);
    return o;
  };

  const commands = [
    new SlashCommandBuilder()
      .setName('lock')
      .setDescription('Verrouiller les salons d une classe')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addStringOption(classOption)
      .addIntegerOption(o => o.setName('duree')
        .setDescription('Réouverture automatique après X minutes')
        .setMinValue(1).setMaxValue(1440))
      .addStringOption(o => o.setName('message')
        .setDescription('Message affiché dans les salons')),

    new SlashCommandBuilder()
      .setName('unlock')
      .setDescription('Rouvrir les salons d une classe')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addStringOption(classOption),

    new SlashCommandBuilder()
      .setName('statut')
      .setDescription('Voir ce qui est verrouillé en ce moment')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  ];

  try {
    await guild.commands.set(commands);
    slashStatus = { ok: true, count: commands.length };
  } catch (err) {
    console.warn(`[slash] enregistrement impossible: ${err.message}`);
    slashStatus = { ok: false, reason: err.message };
  }
  return slashStatus;
}

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand || !interaction.isChatInputCommand()) return;
  const st = s();
  try {
    if (interaction.commandName === 'statut') {
      const entries = Object.entries(st.locks);
      const desc = entries.length
        ? entries.map(([, e]) => `🔒 **#${e.channelName}** — ${Object.keys(e.roles).length} rôle(s)`).join('\n').slice(0, 3800)
        : 'Aucun salon verrouillé.';
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('État des verrous').setDescription(desc)],
      });
    }

    const groupId = interaction.options.getString('classe');
    const group = st.groups.find(g => g.id === groupId);
    if (!group) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Classe inconnue.' });
    if (!group.channelIds.length || !group.roleIds.length) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ La classe ${group.name} n a pas de salons ou de rôles configurés.` });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (interaction.commandName === 'lock') {
      const duree = interaction.options.getInteger('duree');
      const message = interaction.options.getString('message');
      const res = await lock(group.channelIds, group.roleIds, {
        message: message === null ? undefined : message,
        groupId: group.id,
        durationMinutes: duree || null,
        source: `slash:${interaction.user.tag}`,
        label: group.name,
      });
      const ok = res.filter(r => r.ok).length;
      return interaction.editReply(`🔒 **${ok}/${res.length}** salons verrouillés pour **${group.name}**${duree ? ` (réouverture dans ${duree} min)` : ''}.`);
    }

    if (interaction.commandName === 'unlock') {
      const res = await unlock(group.channelIds, group.roleIds, {
        restore: 'restore', source: `slash:${interaction.user.tag}`, label: group.name,
      });
      const ok = res.filter(r => r.ok).length;
      return interaction.editReply(`🔓 **${ok}/${res.length}** salons rouverts pour **${group.name}**.`);
    }
  } catch (err) {
    const payload = { flags: MessageFlags.Ephemeral, content: `❌ ${err.message}` };
    if (interaction.deferred || interaction.replied) interaction.editReply(payload).catch(() => {});
    else interaction.reply(payload).catch(() => {});
  }
}

// ─── Connexion ──────────────────────────────────────────────────────────────
function createClient() {
  const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

  const onReady = async () => {
    if (ready) return;
    ready = true;
    lastError = null;
    connectedAt = new Date().toISOString();
    console.log(`✅ Connecté en tant que ${c.user.tag}`);
    refresh();
    await registerSlashCommands();
    bus.emit('ready');
  };
  // discord.js >= 14.22 renomme « ready » en « clientReady »
  c.once('clientReady', onReady);
  c.once('ready', onReady);

  c.on('interactionCreate', handleInteraction);
  c.on('messageCreate', message => {
    stickers.handle(message, { onChange: () => bus.emit('change') })
      .catch(err => console.error(`[stickers] ${err.message}`));
  });
  c.on('error', err => { lastError = err.message; console.error(`[discord] ${err.message}`); });
  c.on('shardDisconnect', () => { ready = false; bus.emit('change'); });
  c.on('shardResume', () => { ready = true; bus.emit('change'); });

  const dirty = () => { refresh(); bus.emit('change'); };
  c.on('channelCreate', dirty); c.on('channelDelete', dirty); c.on('channelUpdate', dirty);
  c.on('roleCreate', dirty); c.on('roleDelete', dirty); c.on('roleUpdate', dirty);

  return c;
}

async function connect(token, { remember = true } = {}) {
  const st = s();
  const useToken = token || st.token;
  if (!useToken) throw new Error('Aucun token disponible');

  if (client) { try { await client.destroy(); } catch (e) {} }
  ready = false;
  client = createClient();

  try {
    await client.login(useToken);
  } catch (err) {
    lastError = err.message;
    try { await client.destroy(); } catch (e) {}
    client = null;
    throw new Error(`Connexion refusée par Discord : ${err.message}`);
  }

  if (remember && token) { st.token = token; store.save(true); }
  return true;
}

async function disconnect({ forget = false } = {}) {
  if (client) { try { await client.destroy(); } catch (e) {} }
  client = null; ready = false; connectedAt = null;
  if (forget) { s().token = null; store.save(true); }
  bus.emit('change');
}

function status() {
  const st = s();
  return {
    connected: ready,
    hasToken: !!st.token,
    connectedAt,
    lastError,
    slash: slashStatus,
    guild: guildCache.guild,
    channels: guildCache.channels,
    roles: guildCache.roles,
    categories: guildCache.categories,
  };
}

module.exports = {
  bus, connect, disconnect, status, refresh, getGuild, requireGuild,
  lock, unlock, diagnose, sweepExpired, registerSlashCommands,
  isTicketChannel, PROTECT_KEYWORDS,
  isReady: () => ready,
};
