// Vérifie l'annonce de fermeture sans Discord : quand elle est affichée, le
// texte du sujet, et la file des sujets (la dernière valeur demandée gagne).
//   node test/annonce-check.js
const {
  MARQUE, doitAnnoncer, aUnSujet, estSujetDachGuard, heureReouverture, texteSujet, poserSujet,
} = require('../src/annonce');

let bad = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) { bad++; console.log(`  ✗ ${label} — attendu ${expected}, obtenu ${actual}`); }
  else console.log(`  ✓ ${label}`);
}

(async () => {
  const coupe = { announceLock: false };
  const actif = { announceLock: true };
  check('message du créneau affiché même réglage coupé', doitAnnoncer(coupe, 'Bonne nuit - Les salons rouvrent à 8h.'), true);
  check('message par défaut muet si réglage coupé', doitAnnoncer(coupe, undefined), false);
  check('message par défaut affiché si réglage actif', doitAnnoncer(actif, undefined), true);
  check('message vide = rien, même réglage actif', doitAnnoncer(actif, ''), false);
  check('message fait d espaces = message par défaut', doitAnnoncer(coupe, '   '), false);

  // Texte du sujet — 14/10/2026 22 h à Bruxelles, réouverture le lendemain 7 h 30.
  const reglages = { timezone: 'Europe/Brussels', defaultLockMessage: 'Salon fermé.' };
  const soir = new Date('2026-10-14T20:00:00Z');
  check('heure le jour même', heureReouverture('2026-10-14T21:15:00Z', 'Europe/Brussels', soir), '23 h 15');
  check('heure un autre jour', heureReouverture('2026-10-15T05:30:00Z', 'Europe/Brussels', soir), 'jeudi 7 h 30');
  check('sujet complet',
    texteSujet({ message: 'Bonne nuit !', until: '2026-10-15T05:30:00Z', groupName: '3TIN' }, reglages, soir),
    `${MARQUE} (3TIN) — Bonne nuit ! — Réouverture : jeudi 7 h 30`);
  check('sujet avec message par défaut, sans fin', texteSujet({}, reglages, soir), `${MARQUE} — Salon fermé.`);
  check('sujet tronqué à 1024', texteSujet({ message: 'x'.repeat(3000) }, reglages).length, 1024);
  check('sujet DachGuard reconnu', estSujetDachGuard(texteSujet({}, reglages)), true);
  check('sujet ordinaire non reconnu', estSujetDachGuard('Entraide Python'), false);
  check('salon vocal sans sujet', aUnSujet({ id: 'v' }), false);

  // File des sujets : pendant qu'un changement est en vol (limite Discord),
  // les demandes suivantes se remplacent — seule la dernière est écrite.
  const ecrits = [];
  let relacher;
  const salon = {
    id: 'c1', name: 'test', topic: 'Entraide Python',
    setTopic(t) {
      ecrits.push(t);
      return new Promise(r => { relacher = () => { salon.topic = t || ''; r(); }; });
    },
  };
  const fin = poserSujet(salon, 'A');
  poserSujet(salon, 'B');
  poserSujet(salon, 'Entraide Python');
  relacher(); await new Promise(r => setImmediate(r));
  if (ecrits.length > 1) relacher();
  await fin;
  check('premier sujet écrit, puis seulement le dernier', ecrits.join('|'), 'A|Entraide Python');
  check('sujet d origine remis', salon.topic, 'Entraide Python');

  const refuse = { id: 'c2', name: 'refus', topic: '', setTopic: async () => { throw new Error('Missing Permissions'); } };
  const warn = console.warn; console.warn = () => {};
  check('refus de Discord sans planter', await poserSujet(refuse, 'X'), true);
  console.warn = warn;

  console.log(bad ? `\n${bad} échec(s).` : '\nTout passe.');
  process.exit(bad ? 1 : 0);
})();
