const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');

let client = null;
let botStatus = { connected: false, guild: null, channels: [], roles: [] };

// Historique des modifications : { snapshotId, channelId, roleId, before, after, lockedAt }
let permissionHistory = [];

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
    .map(c => ({ id: c.id, name: c.name, parentName: c.parent?.name || 'Sans catégorie' }))
    .sort((a, b) => a.parentName.localeCompare(b.parentName) || a.name.localeCompare(b.name));

  const roles = guild.roles.cache
    .filter(r => r.name !== '@everyone')
    .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
    .sort((a, b) => b.position - a.position);

  botStatus.channels = channels;
  botStatus.roles = roles;

  return botStatus;
}

/**
 * Capture la permission SendMessages actuelle pour un channel + rôle.
 * Retourne null | true | false (null = pas d'overwrite = héritage).
 */
function capturePermission(channel, roleId) {
  const overwrite = channel.permissionOverwrites.cache.get(roleId);
  if (!overwrite) return null;
  if (overwrite.allow.has(PermissionsBitField.Flags.SendMessages)) return true;
  if (overwrite.deny.has(PermissionsBitField.Flags.SendMessages)) return false;
  return null;
}

async function lockChannels(channelIds, roleId, message) {
  if (!client || !client.isReady()) throw new Error('Bot non connecté');

  const guild = client.guilds.cache.first();
  if (!guild) throw new Error('Serveur introuvable');

  const results = [];
  const snapshotId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  const snapshots = [];

  for (const channelId of channelIds) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) continue;

    try {
      // Capture l'état AVANT modification
      const before = capturePermission(channel, roleId);

      await channel.permissionOverwrites.edit(roleId, {
        SendMessages: false,
      });

      if (message && message.trim()) {
        await channel.send(`🔒 ${message}`);
      }

      snapshots.push({ channelId, before });
      results.push({ channelId, success: true });
    } catch (err) {
      results.push({ channelId, success: false, error: err.message });
    }
  }

  // Enregistre le snapshot groupé si au moins un channel a été modifié
  if (snapshots.length > 0) {
    permissionHistory.push({
      snapshotId,
      roleId,
      snapshots,
      lockedAt: new Date().toISOString(),
      message: message || '',
    });
    // Limite l'historique à 50 entrées
    if (permissionHistory.length > 50) permissionHistory.shift();
  }

  return { results, snapshotId: snapshots.length > 0 ? snapshotId : null };
}

async function unlockChannels(channelIds, roleId) {
  if (!client || !client.isReady()) throw new Error('Bot non connecté');

  const guild = client.guilds.cache.first();
  if (!guild) throw new Error('Serveur introuvable');

  const results = [];

  for (const channelId of channelIds) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) continue;

    try {
      await channel.permissionOverwrites.edit(roleId, {
        SendMessages: null,
      });
      results.push({ channelId, success: true });
    } catch (err) {
      results.push({ channelId, success: false, error: err.message });
    }
  }

  return { results };
}

/**
 * Restaure les permissions d'un snapshot (annuler les changements d'un lock).
 */
async function revertSnapshot(snapshotId) {
  if (!client || !client.isReady()) throw new Error('Bot non connecté');

  const guild = client.guilds.cache.first();
  if (!guild) throw new Error('Serveur introuvable');

  const entry = permissionHistory.find(h => h.snapshotId === snapshotId);
  if (!entry) throw new Error('Snapshot introuvable');

  const results = [];

  for (const snap of entry.snapshots) {
    const channel = guild.channels.cache.get(snap.channelId);
    if (!channel) continue;

    try {
      // before: null = héritage, true = allow, false = deny
      await channel.permissionOverwrites.edit(entry.roleId, {
        SendMessages: snap.before, // null remet l'héritage
      });
      results.push({ channelId: snap.channelId, success: true });
    } catch (err) {
      results.push({ channelId: snap.channelId, success: false, error: err.message });
    }
  }

  // Retire le snapshot de l'historique après restauration
  const idx = permissionHistory.findIndex(h => h.snapshotId === snapshotId);
  if (idx !== -1) permissionHistory.splice(idx, 1);

  return { results };
}

/**
 * Retourne la liste des channels actuellement verrouillés par le bot
 * (présents dans l'historique et non encore restaurés).
 */
function getLockedChannels() {
  const locked = new Set();
  for (const entry of permissionHistory) {
    for (const snap of entry.snapshots) {
      locked.add(snap.channelId);
    }
  }
  return [...locked];
}

function getPermissionHistory() {
  return permissionHistory;
}

async function connectBot(token) {
  if (client) {
    try { await client.destroy(); } catch (e) {}
  }
  // Réinitialise l'historique lors d'une reconnexion
  permissionHistory = [];
  createClient();
  await client.login(token);
  return botStatus;
}

function getStatus() {
  return {
    ...botStatus,
    lockedChannels: getLockedChannels(),
  };
}

module.exports = {
  connectBot,
  lockChannels,
  unlockChannels,
  revertSnapshot,
  getLockedChannels,
  getPermissionHistory,
  getStatus,
  refreshGuildData,
};