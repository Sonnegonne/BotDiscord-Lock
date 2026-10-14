// ─────────────────────────────────────────────────────────────────────────────
// annonce.js — signaler la fermeture d'un salon par son sujet
// ─────────────────────────────────────────────────────────────────────────────
// Tout nouveau message, même @silent, marque le salon « non lu » chez chaque
// élève : l'encart de fermeture faisait venir tout le monde voir « un message ».
// Depuis le 14/10/2026, la fermeture s'écrit dans le SUJET du salon (visible
// dans l'en-tête), ce qui ne crée ni notification ni pastille. Le sujet
// d'origine est remis à la réouverture.

const MARQUE = '🔒 Salon verrouillé';
const LIMITE_SUJET = 1024;

// Le réglage « Annoncer la fermeture » ne gouverne que le message par défaut.
// Un message écrit exprès (sur un créneau, au dashboard, au téléphone) est
// toujours affiché : avant le correctif du 07/10, le réglage coupé faisait
// disparaître en silence les « Bonne nuit » des planifications.
// message : undefined/null = message par défaut, '' = rien.
function doitAnnoncer(settings, message) {
  if (message === '') return false;
  if (typeof message === 'string' && message.trim()) return true;
  return !!(settings && settings.announceLock);
}

// Les salons vocaux n'ont pas de sujet : ils restent sans annonce.
function aUnSujet(channel) {
  return !!channel && typeof channel.setTopic === 'function';
}

function estSujetDachGuard(topic) {
  return typeof topic === 'string' && topic.startsWith(MARQUE);
}

// « 7 h 30 » le jour même, « lundi 7 h 30 » un autre jour.
function heureReouverture(until, timeZone, maintenant = new Date()) {
  if (!until) return null;
  const d = new Date(until);
  if (isNaN(d)) return null;
  const tz = timeZone || 'Europe/Brussels';
  const jour = x => x.toLocaleDateString('fr-BE', { timeZone: tz });
  const parts = Object.fromEntries(new Intl.DateTimeFormat('fr-BE', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(p => [p.type, p.value]));
  const heure = `${Number(parts.hour)} h ${parts.minute}`;
  if (jour(d) === jour(maintenant)) return heure;
  return `${d.toLocaleDateString('fr-BE', { timeZone: tz, weekday: 'long' })} ${heure}`;
}

function texteSujet({ message, until, groupName }, settings = {}, maintenant) {
  let tete = MARQUE;
  if (groupName) tete += ` (${groupName})`;
  const morceaux = [tete];
  const texte = (message && String(message).trim()) || settings.defaultLockMessage || '';
  if (texte) morceaux.push(texte);
  const quand = heureReouverture(until, settings.timezone, maintenant);
  if (quand) morceaux.push(`Réouverture : ${quand}`);
  return morceaux.join(' — ').slice(0, LIMITE_SUJET);
}

// Discord n'accepte que deux changements de sujet par 10 min et par salon ;
// au-delà, discord.js attend. Ces écritures ne passent donc PAS par la file des
// permissions (elles la bloqueraient) : chaque salon a sa propre petite file où
// seule la dernière valeur demandée compte.
const voulu = new Map();     // channelId -> { channel, topic, raison }
const enCours = new Set();

function poserSujet(channel, topic, raison) {
  if (!aUnSujet(channel)) return Promise.resolve(false);
  voulu.set(channel.id, { channel, topic: topic || '', raison });
  if (enCours.has(channel.id)) return Promise.resolve(true);
  enCours.add(channel.id);
  return (async () => {
    try {
      while (voulu.has(channel.id)) {
        const v = voulu.get(channel.id);
        voulu.delete(channel.id);
        if ((v.channel.topic || '') === v.topic) continue;
        try {
          await v.channel.setTopic(v.topic || null, v.raison);
        } catch (err) {
          console.warn(`[lock] sujet impossible dans #${v.channel.name}: ${err.message}`);
        }
      }
    } finally {
      enCours.delete(channel.id);
    }
    return true;
  })();
}

module.exports = {
  MARQUE, doitAnnoncer, aUnSujet, estSujetDachGuard, heureReouverture, texteSujet, poserSujet,
};
