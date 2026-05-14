const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');

let client = null;
let botStatus = { connected: false, guild: null, channels: [], roles: [] };

// Rôle par défaut
let defaultRoleId = null;

// Snapshot des permissions avant lock: { channelId: { roleId: { allow, deny } } }
let permissionSnapshots = {};

// État des channels modifiés: { channelId: { locked: bool, lockedAt, roleId } }
let channelStates = {};

// Catégories dont les channels sont gérés par "View Channel" plutôt que "Send Messages"
const TICKET_CATEGORY_KEYWORDS = ['ticket', 'tickets'];

function isTicketChannel(channel) {
  const parentName = (channel.parent?.name || '').toLowerCase();
  return TICKET_CATEGORY_KEYWORDS.some(kw => parentName.includes(kw));
}

function createClient() {
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
    ]
  });

  client.on('ready', async () => {
    console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
    botStatus.connected = true;
    await refreshGuildData();
  });

  client.on('disconnect', () => {
    botStatus.connected = false;
  });

  return client;
}

async function refreshGuildData() {
  if (!client || !client.isReady()) return;

  const guilds = client.guilds.cache;
  if (guilds.size === 0) return;

  const guild = guilds.first();
  botStatus.guild = { id: guild.id, name: guild.name, icon: guild.iconURL() };

  const channels = guild.channels.cache
    .filter(c => c.type === 0)
    .map(c => ({
      id: c.id,
      name: c.name,
      parentName: c.parent?.name || 'Sans catégorie',
      isTicket: isTicketChannel(c),
    }))
    .sort((a, b) => a.parentName.localeCompare(b.parentName) || a.name.localeCompare(b.name));

  const roles = guild.roles.cache
    .filter(r => r.name !== '@everyone')
    .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
    .sort((a, b) => b.position - a.position);

  botStatus.channels = channels;
  botStatus.roles = roles;

  return botStatus;
}

// Sauvegarde les permissions actuelles d'un channel pour un rôle
async function snapshotPermissions(channel, roleId) {
  if (!permissionSnapshots[channel.id]) permissionSnapshots[channel.id] = {};

  const existing = channel.permissionOverwrites.cache.get(roleId);
  permissionSnapshots[channel.id][roleId] = existing
    ? { allow: existing.allow.bitfield, deny: existing.deny.bitfield, existed: true }
    : { existed: false };
}

async function lockChannels(channelIds, roleId, message) {
  if (!client || !client.isReady()) throw new Error('Bot non connecté');
  const guild = client.guilds.cache.first();
  if (!guild) throw new Error('Serveur introuvable');

  const results = [];

  for (const channelId of channelIds) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) continue;

    try {
      // Snapshot avant modification
      await snapshotPermissions(channel, roleId);

      if (isTicketChannel(channel)) {
        // Channels Ticket : on interdit "View Channel" pour les cacher complètement
        await channel.permissionOverwrites.edit(roleId, {
          ViewChannel: false,
        });
      } else {
        // Channels normaux : interdire l'envoi de messages
        await channel.permissionOverwrites.edit(roleId, {
          SendMessages: false,
        });
      }

      // Envoyer le message de lock UNIQUEMENT si fourni et non-vide
      if (message && message.trim() && !isTicketChannel(channel)) {
        try {
          const sentMsg = await channel.send(`🔒 ${message}`);
          // Stocker l'ID du message pour pouvoir le supprimer après
          channelStates[channelId] = {
            locked: true,
            lockedAt: new Date().toISOString(),
            roleId,
            channelName: channel.name,
            parentName: channel.parent?.name || 'Sans catégorie',
            lockMessageId: sentMsg.id,
          };
        } catch (msgErr) {
          // Si on ne peut pas envoyer le message (ex: bot n'a pas accès), on continue quand même
          channelStates[channelId] = {
            locked: true,
            lockedAt: new Date().toISOString(),
            roleId,
            channelName: channel.name,
            parentName: channel.parent?.name || 'Sans catégorie',
            lockMessageId: null,
          };
        }
      } else {
        channelStates[channelId] = {
          locked: true,
          lockedAt: new Date().toISOString(),
          roleId,
          channelName: channel.name,
          parentName: channel.parent?.name || 'Sans catégorie',
          lockMessageId: null,
        };
      }

      results.push({ channelId, success: true });
    } catch (err) {
      results.push({ channelId, success: false, error: err.message });
    }
  }

  return results;
}

async function unlockChannels(channelIds, roleId, restoreInitial = false) {
  if (!client || !client.isReady()) throw new Error('Bot non connecté');
  const guild = client.guilds.cache.first();
  if (!guild) throw new Error('Serveur introuvable');

  const results = [];

  for (const channelId of channelIds) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) continue;

    try {
      // Supprimer le message de lock s'il existe
      const state = channelStates[channelId];
      if (state?.lockMessageId) {
        try {
          const msg = await channel.messages.fetch(state.lockMessageId);
          if (msg) await msg.delete();
        } catch (msgErr) {
          // Message déjà supprimé ou inaccessible, on ignore
          console.warn(`[unlock] Impossible de supprimer le message de lock dans #${channel.name}: ${msgErr.message}`);
        }
      }

      const snapshot = permissionSnapshots[channelId]?.[roleId];

      if (restoreInitial && snapshot) {
        if (!snapshot.existed) {
          // Supprimer le overwrite ajouté par le bot
          const ow = channel.permissionOverwrites.cache.get(roleId);
          if (ow) await ow.delete();
        } else {
          // Restaurer l'état exact d'avant
          await channel.permissionOverwrites.edit(roleId, {
            allow: snapshot.allow,
            deny: snapshot.deny,
          });
        }
      } else {
        // Remettre explicitement la permission en "autorisé" pour que l'écriture fonctionne
        if (isTicketChannel(channel)) {
          await channel.permissionOverwrites.edit(roleId, {
            ViewChannel: true,
          });
        } else {
          await channel.permissionOverwrites.edit(roleId, {
            SendMessages: true,
          });
        }
      }

      delete channelStates[channelId];
      if (permissionSnapshots[channelId]) delete permissionSnapshots[channelId][roleId];

      results.push({ channelId, success: true });
    } catch (err) {
      results.push({ channelId, success: false, error: err.message });
    }
  }

  return results;
}

async function lockAllChannels(message) {
  if (!defaultRoleId) throw new Error('Aucun rôle par défaut défini');
  if (!client || !client.isReady()) throw new Error('Bot non connecté');

  const guild = client.guilds.cache.first();
  if (!guild) throw new Error('Serveur introuvable');

  const allChannelIds = guild.channels.cache
    .filter(c => c.type === 0)
    .map(c => c.id);

  return lockChannels(allChannelIds, defaultRoleId, message);
}

async function unlockAllChannels(restoreInitial = false) {
  if (!client || !client.isReady()) throw new Error('Bot non connecté');
  const guild = client.guilds.cache.first();
  if (!guild) throw new Error('Serveur introuvable');

  // Unlock tous les channels actuellement verrouillés par le bot
  const lockedIds = Object.keys(channelStates).filter(id => channelStates[id].locked);

  if (lockedIds.length === 0) {
    // Fallback: tous les channels avec le rôle par défaut
    if (!defaultRoleId) throw new Error('Aucun rôle par défaut défini');
    const allChannelIds = guild.channels.cache.filter(c => c.type === 0).map(c => c.id);
    return unlockChannels(allChannelIds, defaultRoleId, restoreInitial);
  }

  const results = [];
  for (const channelId of lockedIds) {
    const roleId = channelStates[channelId].roleId;
    const r = await unlockChannels([channelId], roleId, restoreInitial);
    results.push(...r);
  }
  return results;
}

function setDefaultRole(roleId) {
  defaultRoleId = roleId;
  return defaultRoleId;
}

function getDefaultRole() {
  return defaultRoleId;
}

function getChannelStates() {
  return channelStates;
}

async function connectBot(token) {
  if (client) {
    try { await client.destroy(); } catch (e) {}
  }
  // Reset state on reconnect
  permissionSnapshots = {};
  channelStates = {};
  createClient();
  await client.login(token);
  return botStatus;
}

function getStatus() {
  return { ...botStatus, defaultRoleId };
}

module.exports = {
  connectBot,
  lockChannels,
  unlockChannels,
  lockAllChannels,
  unlockAllChannels,
  getStatus,
  refreshGuildData,
  setDefaultRole,
  getDefaultRole,
  getChannelStates,
};