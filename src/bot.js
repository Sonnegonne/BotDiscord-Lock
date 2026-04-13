const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');

let client = null;
let botStatus = { connected: false, guild: null, channels: [], roles: [] };

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

  // Channels textuels
  const channels = guild.channels.cache
    .filter(c => c.type === 0) // GUILD_TEXT
    .map(c => ({ id: c.id, name: c.name, parentName: c.parent?.name || 'Sans catégorie' }))
    .sort((a, b) => a.parentName.localeCompare(b.parentName) || a.name.localeCompare(b.name));

  // Rôles (sans @everyone)
  const roles = guild.roles.cache
    .filter(r => r.name !== '@everyone')
    .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
    .sort((a, b) => b.position - a.position);

  botStatus.channels = channels;
  botStatus.roles = roles;

  return botStatus;
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
      // Retire la permission d'envoyer des messages pour ce rôle
      await channel.permissionOverwrites.edit(roleId, {
        SendMessages: false,
      });

      // Envoie le message de lock si fourni
      if (message && message.trim()) {
        await channel.send(`🔒 ${message}`);
      }

      results.push({ channelId, success: true });
    } catch (err) {
      results.push({ channelId, success: false, error: err.message });
    }
  }

  return results;
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
      // Remet la permission à null (hérite des permissions par défaut)
      await channel.permissionOverwrites.edit(roleId, {
        SendMessages: null,
      });

      results.push({ channelId, success: true });
    } catch (err) {
      results.push({ channelId, success: false, error: err.message });
    }
  }

  return results;
}

async function connectBot(token) {
  if (client) {
    try { await client.destroy(); } catch (e) {}
  }
  createClient();
  await client.login(token);
  return botStatus;
}

function getStatus() {
  return botStatus;
}

function getClient() {
  return client;
}

module.exports = { connectBot, lockChannels, unlockChannels, getStatus, refreshGuildData };
