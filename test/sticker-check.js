// Vérifie la garde anti-stickers sans Discord : la décision (qui passe, qui non),
// la lecture d'un message, l'anti-spam du rappel et le compteur.
//   node test/sticker-check.js
const path = require('path');
process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data-test');

const store = require('../src/store');
const stickers = require('../src/stickers');

store.load();

const CHAN = 'chan-general';
const CAT = 'cat-3eme';
const THREAD = 'thread-1';
const PROF = 'role-prof';
const ELEVE = 'role-eleve';

let bad = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { bad++; console.log(`  ✗ ${label} — attendu ${expected}, obtenu ${actual}`); }
  else console.log(`  ✓ ${label}`);
}

const base = {
  hasSticker: true, isBot: false,
  channelIds: [CHAN, CAT], authorRoleIds: [ELEVE], canManageMessages: false,
};
const on = { ...stickers.defaults(), enabled: true };

console.log('\nLa décision');
check('garde désactivée : on ne touche à rien',
  stickers.decide(base, { ...on, enabled: false }).remove, false);
check('message sans sticker : on ne touche à rien',
  stickers.decide({ ...base, hasSticker: false }, on).remove, false);
check('sticker d un élève : supprimé',
  stickers.decide(base, on).remove, true);
check('salon exempté : épargné',
  stickers.decide(base, { ...on, exemptChannelIds: [CHAN] }).remove, false);
check('catégorie exemptée : épargné',
  stickers.decide(base, { ...on, exemptChannelIds: [CAT] }).remove, false);
check('fil dans un salon exempté : épargné',
  stickers.decide({ ...base, channelIds: [THREAD, CHAN, CAT] }, { ...on, exemptChannelIds: [CHAN] }).remove, false);
check('rôle exempté mais auteur sans ce rôle : supprimé',
  stickers.decide(base, { ...on, exemptRoleIds: [PROF] }).remove, true);
check('auteur porteur du rôle exempté : épargné',
  stickers.decide({ ...base, authorRoleIds: [ELEVE, PROF] }, { ...on, exemptRoleIds: [PROF] }).remove, false);
check('modération autorisée : épargné',
  stickers.decide({ ...base, canManageMessages: true }, on).remove, false);
check('modération non autorisée : supprimé quand même',
  stickers.decide({ ...base, canManageMessages: true }, { ...on, allowStaff: false }).remove, true);
check('autre bot toléré par défaut',
  stickers.decide({ ...base, isBot: true }, on).remove, false);
check('autre bot non toléré si on le demande',
  stickers.decide({ ...base, isBot: true }, { ...on, allowBots: false }).remove, true);

console.log('\nLecture d un message Discord');
const fakeMessage = {
  guild: { id: 'g1' },
  author: { id: 'u1', bot: false, tag: 'eleve#0001', toString: () => '<@u1>' },
  stickers: new Map([['s1', { name: 'chat rigolo' }]]),
  member: { roles: { cache: new Map([[ELEVE, {}]]) } },
  channel: {
    id: CHAN, name: 'general', parentId: CAT, parent: { parentId: null },
    permissionsFor: () => ({ has: () => false }),
    send: async (payload) => { fakeMessage.sent = payload; return { delete: async () => {} }; },
  },
  delete: async () => { fakeMessage.deleted = true; },
};
const seen = stickers.describe(fakeMessage);
check('sticker repéré', seen.hasSticker, true);
check('salon + catégorie remontés', seen.channelIds.join(','), `${CHAN},${CAT}`);
check('rôles de l auteur remontés', seen.authorRoleIds.join(','), ELEVE);
check('pas modérateur', seen.canManageMessages, false);

console.log('\nSuppression réelle (garde activée)');
const st = store.get();
st.settings.stickerGuard = { ...on, warn: true };
st.stickerStats = { removed: 0, lastAt: null, lastUser: null, lastChannel: null, lastError: null };
const before = st.activity.length;

stickers.handle(fakeMessage).then(res => {
  check('message supprimé', res.removed, true);
  check('nom du sticker retenu', res.sticker, 'chat rigolo');
  check('message effectivement effacé', fakeMessage.deleted, true);
  check('rappel envoyé à l auteur', typeof fakeMessage.sent?.content === 'string', true);
  check('compteur incrémenté', store.get().stickerStats.removed, 1);
  check('entrée au journal', store.get().activity.length, before + 1);
  check('journal typé « sticker »', store.get().activity[0].type, 'sticker');

  console.log('\nAnti-spam du rappel');
  check('premier rappel autorisé', stickers.shouldWarn('c2', 'u9', 1_000_000), true);
  check('deuxième rappel dans les 30 s : muet', stickers.shouldWarn('c2', 'u9', 1_005_000), false);
  check('après 30 s : de nouveau autorisé', stickers.shouldWarn('c2', 'u9', 1_040_000), true);

  console.log(bad ? `\n${bad} problème(s)` : '\nLa garde anti-stickers se comporte comme prévu.');
  process.exit(bad ? 1 : 0);
}).catch(e => { console.error('ÉCHEC :', e.stack); process.exit(1); });
