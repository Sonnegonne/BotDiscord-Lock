// ─────────────────────────────────────────────────────────────────────────────
// permissions.js — traduction « verrouiller » → overwrites Discord
// Séparé du bot pour pouvoir être testé sans connexion.
// ─────────────────────────────────────────────────────────────────────────────
const { PermissionsBitField, ChannelType } = require('discord.js');

const TEXTUAL = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const VOCAL = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];
const FORUM = [ChannelType.GuildForum, ChannelType.GuildMedia];

const LOCKABLE_TYPES = [...TEXTUAL, ...VOCAL, ...FORUM];

function kindOf(type) {
  if (VOCAL.includes(type)) return 'voice';
  if (FORUM.includes(type)) return 'forum';
  if (type === ChannelType.GuildAnnouncement) return 'announcement';
  return 'text';
}

// Permissions touchées par un verrou, selon le type de salon et le mode.
// `hide`  : le salon disparaît de la liste (utilisé pour les tickets)
// `write` : le salon reste visible mais devient lecture seule
function lockedPerms(kind, mode, strict) {
  if (mode === 'hide') return { ViewChannel: false };

  if (kind === 'voice') {
    return strict ? { Connect: false, Speak: false } : { Connect: false };
  }
  if (kind === 'forum') {
    const p = { CreatePublicThreads: false, CreatePrivateThreads: false, SendMessagesInThreads: false };
    if (strict) p.AddReactions = false;
    return p;
  }
  const p = { SendMessages: false };
  if (strict) {
    p.SendMessagesInThreads = false;
    p.CreatePublicThreads = false;
    p.CreatePrivateThreads = false;
    p.AddReactions = false;
  }
  return p;
}

// Liste historique des clés que le bot a pu poser, tous types de salons
// confondus. Gardée pour le diagnostic — surtout PAS pour effacer en bloc :
// remettre `ViewChannel` à `null` sur un rôle qui tenait de cette ligne son
// droit de voir le salon le prive du salon. C'est le bug du 22/09/2026.
const ALL_TOUCHED = [
  'ViewChannel', 'SendMessages', 'SendMessagesInThreads',
  'CreatePublicThreads', 'CreatePrivateThreads', 'AddReactions',
  'Connect', 'Speak',
];

// Remet à `null` (= hérité) uniquement les permissions que CE verrou a posées,
// jamais plus. Jamais `true` non plus : forcer `true` donnerait au rôle plus de
// droits qu'avant le verrou.
function clearPerms(kind, mode) {
  // `strict` à true : on ratisse les clés des deux réglages, car le mode strict
  // a pu changer entre la pose du verrou et sa levée.
  const posees = lockedPerms(kind, mode, true);
  return Object.fromEntries(Object.keys(posees).map(k => [k, null]));
}

function allowPerms(kind, mode) {
  if (mode === 'hide') return { ViewChannel: true };
  if (kind === 'voice') return { Connect: true, Speak: true };
  if (kind === 'forum') return { CreatePublicThreads: true, SendMessagesInThreads: true };
  return { SendMessages: true };
}

// Reconstruit l'overwrite exact d'avant le verrou à partir des bitfields.
// discord.js n'accepte pas {allow, deny} dans .edit() : il faut lui repasser
// chaque permission nommée à true / false / null.
function snapshotToOptions(snapshot) {
  const allow = new PermissionsBitField(BigInt(snapshot.allow || 0));
  const deny = new PermissionsBitField(BigInt(snapshot.deny || 0));
  const options = {};
  for (const flag of Object.keys(PermissionsBitField.Flags)) {
    if (allow.has(flag)) options[flag] = true;
    else if (deny.has(flag)) options[flag] = false;
    else options[flag] = null;
  }
  return options;
}

// Que faire d'une ligne de permissions au déverrouillage ? Isolé ici pour être
// testable sans Discord : c'est ce choix qui, mal fait, a effacé des rôles.
//   'forcer'    : autorisation explicite demandée (mode « allow »)
//   'supprimer' : la ligne n'existait pas avant le verrou — le bot la retire
//   'restaurer' : on réécrit à l'identique la ligne d'avant le verrou
//   'liberer'   : aucune photo d'avant — on se contente de lever les
//                 permissions que le verrou pose, sans rien supprimer
function planDeverrouillage(mode, snap) {
  if (mode === 'allow') return 'forcer';
  if (snap && snap.existed === false) return 'supprimer';
  if (snap) return 'restaurer';
  return 'liberer';
}

// Un rôle « fuit » s'il peut écrire alors qu'on verrouille : soit il est
// administrateur, soit il a une autorisation explicite sur ce salon.
function bypassKeys(kind, mode) {
  if (mode === 'hide') return ['ViewChannel'];
  if (kind === 'voice') return ['Connect'];
  if (kind === 'forum') return ['SendMessagesInThreads', 'CreatePublicThreads'];
  return ['SendMessages'];
}

module.exports = {
  LOCKABLE_TYPES, kindOf, lockedPerms, clearPerms, allowPerms,
  snapshotToOptions, bypassKeys, ALL_TOUCHED, planDeverrouillage,
};
