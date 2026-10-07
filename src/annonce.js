// ─────────────────────────────────────────────────────────────────────────────
// annonce.js — quand poster l'encart de fermeture, et comment l'épingler
// ─────────────────────────────────────────────────────────────────────────────
const { MessageType } = require('discord.js');

// Le réglage « Annoncer la fermeture » ne gouverne que l'encart par défaut.
// Un message écrit exprès (sur un créneau, au dashboard, au téléphone) est
// toujours posté : avant ce correctif, le réglage coupé faisait disparaître en
// silence les « Bonne nuit » des planifications.
// message : undefined/null = message par défaut, '' = pas d'encart.
function doitAnnoncer(settings, message) {
  if (message === '') return false;
  if (typeof message === 'string' && message.trim()) return true;
  return !!(settings && settings.announceLock);
}

// Épingle l'encart puis efface l'avis « DachGuard a épinglé un message » que
// Discord poste juste après. Un échec ici n'empêche pas le verrouillage :
// l'encart reste posté, simplement sans épingle.
async function epingler(msg) {
  try {
    await msg.pin('DachGuard — encart de fermeture');
  } catch (err) {
    console.warn(`[lock] épinglage impossible dans #${msg.channel?.name}: ${err.message}`);
    return false;
  }
  try {
    const suivants = await msg.channel.messages.fetch({ after: msg.id, limit: 10 });
    for (const m of suivants.values()) {
      if (m.type === MessageType.ChannelPinnedMessage && m.reference?.messageId === msg.id) {
        await m.delete().catch(() => {});
      }
    }
  } catch (e) { /* l'avis d'épinglage reste visible, sans gravité */ }
  return true;
}

module.exports = { doitAnnoncer, epingler };
