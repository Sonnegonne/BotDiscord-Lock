// ─────────────────────────────────────────────────────────────────────────────
// test/verrou-check.js — rejoue l'incident du 22/09/2026 sans Discord.
// Ce soir-là, un second clic sur « déverrouiller » a retiré ViewChannel au rôle
// 3TIN sur sept salons, puis supprimé sa ligne de permissions. Les assertions
// ci-dessous décrivent ce qui n'a plus le droit d'arriver.
//   node test/verrou-check.js
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const path = require('path');
process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data-test');

const {
  clearPerms, lockedPerms, snapshotToOptions, planDeverrouillage, kindOf,
} = require('../src/permissions');
const { ChannelType, PermissionsBitField } = require('discord.js');

let ok = 0;
function t(nom, fn) {
  try { fn(); ok++; console.log(`  ✅ ${nom}`); }
  catch (err) { console.error(`  ❌ ${nom}\n     ${err.message}`); process.exitCode = 1; }
}

console.log('\n── Levée de verrou sans photo d\'avant ──');

t('un salon textuel ne perd jamais ViewChannel', () => {
  const p = clearPerms('text', 'write');
  assert.ok(!('ViewChannel' in p), 'ViewChannel ne doit pas être touché');
  assert.strictEqual(p.SendMessages, null);
});

t('un salon vocal ne perd ni ViewChannel ni rien d\'écrit', () => {
  const p = clearPerms('voice', 'write');
  assert.ok(!('ViewChannel' in p));
  assert.ok(!('SendMessages' in p));
  assert.strictEqual(p.Connect, null);
});

t('un forum ne perd que ses permissions de fil', () => {
  const p = clearPerms('forum', 'write');
  assert.ok(!('ViewChannel' in p));
  assert.strictEqual(p.CreatePublicThreads, null);
});

t('le mode « masquer » lève bien ViewChannel, lui', () => {
  assert.strictEqual(clearPerms('text', 'hide').ViewChannel, null);
});

t('on ne lève jamais plus que ce que le verrou pose', () => {
  for (const kind of ['text', 'voice', 'forum', 'announcement']) {
    for (const mode of ['write', 'hide']) {
      const pose = Object.keys(lockedPerms(kind, mode, true));
      for (const cle of Object.keys(clearPerms(kind, mode))) {
        assert.ok(pose.includes(cle), `${kind}/${mode} : ${cle} n'est pas posé par le verrou`);
      }
    }
  }
});

console.log('\n── Choix fait au déverrouillage ──');

t('photo d\'avant présente → réécriture à l\'identique', () => {
  assert.strictEqual(planDeverrouillage('restore', { existed: true, allow: '1024', deny: '0' }), 'restaurer');
});

t('ligne créée par le bot → suppression', () => {
  assert.strictEqual(planDeverrouillage('restore', { existed: false }), 'supprimer');
});

t('SECOND déverrouillage (photo déjà consommée) → on libère, on ne supprime pas', () => {
  // C'est exactement le cas du 22/09 : le premier clic a restauré et effacé la
  // photo, le second n'en trouvait plus. Il doit lever le verrou, rien de plus.
  assert.strictEqual(planDeverrouillage('restore', undefined), 'liberer');
});

t('autorisation forcée reste prioritaire', () => {
  assert.strictEqual(planDeverrouillage('allow', undefined), 'forcer');
});

console.log('\n── Photo d\'avant → options Discord ──');

t('une ligne « voit + lit » est restituée telle quelle', () => {
  const allow = new PermissionsBitField([
    PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory,
  ]).bitfield.toString();
  const o = snapshotToOptions({ allow, deny: '0' });
  assert.strictEqual(o.ViewChannel, true);
  assert.strictEqual(o.ReadMessageHistory, true);
  assert.strictEqual(o.SendMessages, null);
});

t('le type de salon est bien reconnu', () => {
  assert.strictEqual(kindOf(ChannelType.GuildText), 'text');
  assert.strictEqual(kindOf(ChannelType.GuildVoice), 'voice');
  assert.strictEqual(kindOf(ChannelType.GuildForum), 'forum');
});

console.log('\n── La main passe avant la planification ──');

const store = require('../src/store');
const scheduler = require('../src/scheduler');

const st = store.get();
st.groups = [{ id: 'g1', name: '3TIN', channelIds: ['c1', 'c2'], roleIds: ['r1'], enabled: true }];
st.schedules = [{
  id: 's1', name: 'Nuit', groupId: 'g1', days: [0, 1, 2, 3, 4, 5, 6],
  startTime: '00:00', endTime: '23:59', channelIds: [], roleIds: [],
  mode: 'auto', lockMessage: null, active: true,
}];
const sc = st.schedules[0];

t('le créneau est bien en cours', () => {
  assert.ok(scheduler.isWithinWindow(sc), 'créneau 00:00→23:59 : on doit être dedans');
  assert.ok(scheduler.finDuCreneau(sc), 'la fin du créneau doit être calculable');
});

t('rouvrir à la main met le créneau en pause jusqu\'à sa fin', () => {
  const pauses = scheduler.pauseCreneauEnCours(['c1'], 'slash:prof');
  assert.strictEqual(pauses.length, 1);
  assert.strictEqual(pauses[0].name, 'Nuit');
  assert.ok(scheduler.overrideActif(sc), 'la pause doit être active');
  assert.strictEqual(sc.overrideUntil, scheduler.finDuCreneau(sc));
});

t('pendant la pause : toujours dans le créneau, mais plus de reverrouillage', () => {
  const vue = scheduler.list().find(x => x.id === 's1');
  assert.strictEqual(vue.running, true, 'le créneau reste « en cours »');
  assert.ok(vue.pausedUntil, 'le dashboard doit annoncer la pause');
  // C'est la règle qui manquait : dans le créneau, mais on ne referme pas.
  assert.strictEqual(scheduler.isWithinWindow(sc) && !scheduler.overrideActif(sc), false);
});

t('la pause survit à une modification de la planification', () => {
  scheduler.update('s1', { name: 'Nuit semaine' });
  assert.ok(scheduler.overrideActif(st.schedules[0]), 'la pause ne doit pas sauter');
});

t('une planification voisine qui ne vise pas ces salons n\'est pas touchée', () => {
  st.schedules.push({
    id: 's2', name: 'Autre', groupId: null, days: [0, 1, 2, 3, 4, 5, 6],
    startTime: '00:00', endTime: '23:59', channelIds: ['zz'], roleIds: ['r9'],
    mode: 'auto', lockMessage: null, active: true,
  });
  scheduler.pauseCreneauEnCours(['c1'], 'dashboard');
  assert.ok(!scheduler.overrideActif(st.schedules[1]), 'une autre cible ne doit pas être mise en pause');
});

t('refermer à la main rend la main à la planification', () => {
  scheduler.repriseCreneau(['c1']);
  assert.ok(!scheduler.overrideActif(st.schedules[0]), 'la pause doit être levée');
});

t('une pause expirée ne survit pas à son créneau', () => {
  st.schedules[0].overrideUntil = new Date(Date.now() - 1000).toISOString();
  assert.strictEqual(scheduler.overrideActif(st.schedules[0]), false);
});

console.log(`\n${process.exitCode ? '❌ échec' : `✅ ${ok} vérifications passées`}\n`);
