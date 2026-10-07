// Vérifie l'encart de fermeture sans Discord : quand il est posté, et
// l'épinglage (avec effacement de l'avis « a épinglé un message »).
//   node test/annonce-check.js
const { MessageType } = require('discord.js');
const { doitAnnoncer, epingler } = require('../src/annonce');

let bad = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { bad++; console.log(`  ✗ ${label} — attendu ${expected}, obtenu ${actual}`); }
  else console.log(`  ✓ ${label}`);
}

(async () => {
  const coupe = { announceLock: false };
  const actif = { announceLock: true };
  check('message du créneau posté même réglage coupé', doitAnnoncer(coupe, 'Bonne nuit - Les salons rouvrent à 8h.'), true);
  check('message par défaut muet si réglage coupé', doitAnnoncer(coupe, undefined), false);
  check('message par défaut posté si réglage actif', doitAnnoncer(actif, undefined), true);
  check('message vide = pas d encart, même réglage actif', doitAnnoncer(actif, ''), false);
  check('message fait d espaces = message par défaut', doitAnnoncer(coupe, '   '), false);

  // Faux salon : l'encart, l'avis d'épinglage de Discord, et un message d'élève.
  const effaces = [];
  const fauxMsg = (id, type, ref) => ({ id, type, reference: ref ? { messageId: ref } : null, delete: async () => { effaces.push(id); } });
  const avis = fauxMsg('m2', MessageType.ChannelPinnedMessage, 'm1');
  const eleve = fauxMsg('m3', MessageType.Default, null);
  const channel = { name: 'test', messages: { fetch: async () => new Map([['m2', avis], ['m3', eleve]]) } };
  let epingle = false;
  const encart = { id: 'm1', channel, pin: async () => { epingle = true; } };
  check('épinglage réussi', await epingler(encart), true);
  check('encart épinglé', epingle, true);
  check('avis d épinglage effacé, rien d autre', effaces.join(','), 'm2');

  const refuse = { id: 'm9', channel, pin: async () => { throw new Error('Missing Permissions'); } };
  const warn = console.warn; console.warn = () => {};
  check('épinglage refusé sans planter', await epingler(refuse), false);
  console.warn = warn;

  console.log(bad ? `\n${bad} échec(s).` : '\nTout passe.');
  process.exit(bad ? 1 : 0);
})();
