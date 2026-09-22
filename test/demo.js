// ─────────────────────────────────────────────────────────────────────────────
// test/demo.js — lance le dashboard SANS Discord, avec un faux serveur.
// Sert à vérifier l interface : les actions d écriture répondent en erreur.
//   node test/demo.js        puis   http://localhost:3999/lock
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
process.env.PORT = process.env.PORT || '3999';
process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data-demo');

const fixture = require('./fixture-guild.json');
const bot = require('../src/bot');
const store = require('../src/store');

const channels = fixture.channels.map((c, i) => ({
  id: c.id, name: c.name, kind: 'text',
  parentId: 'cat' + i, parentName: c.parentName, parentPosition: i, position: i,
  isTicket: !!c.isTicket, protected: false,
}));
const roles = fixture.roles.map((r, i) => ({
  id: r.id, name: r.name, color: r.color === '#000000' ? '#99aab5' : r.color,
  position: 100 - i, admin: /admin/i.test(r.name), manageable: !/admin/i.test(r.name),
}));

bot.status = () => ({
  connected: true, hasToken: true, connectedAt: new Date(Date.now() - 3600e3).toISOString(),
  lastError: null, slash: { ok: true, count: 3 },
  guild: {
    id: fixture.guild.id, name: fixture.guild.name + ' (démo)', icon: null,
    memberCount: 42, botTag: 'DachGuard#0000', botRolePosition: 50, canManageRoles: true,
    canManageMessages: true, everyoneCanUseExternalStickers: true,
  },
  channels, roles, categories: [],
});
bot.isReady = () => true;
bot.refresh = () => bot.status();
bot.registerSlashCommands = async () => ({ ok: true, count: 3 });

store.load();
require('../src/groups').seed();

// quelques verrous et un peu de journal pour voir l interface remplie
const st = store.get();
const g0 = st.groups[0];
if (g0 && !Object.keys(st.locks).length) {
  for (const id of g0.channelIds.slice(0, 2)) {
    const c = channels.find(x => x.id === id);
    st.locks[id] = {
      channelName: c.name, parentName: c.parentName, messageId: null,
      roles: Object.fromEntries(g0.roleIds.map(r => [r, {
        lockedAt: new Date(Date.now() - 900e3).toISOString(), mode: 'write',
        until: new Date(Date.now() + 1800e3).toISOString(), source: 'démo', groupId: g0.id,
      }])),
    };
  }
  store.logActivity({ type: 'lock', source: 'démo', label: g0.name, count: 2, total: 2, detail: 'salon-a, salon-b' });
  store.logActivity({ type: 'unlock', source: 'planification', label: 'Nuit 3TIN', count: 7, total: 7 });
  store.logActivity({ type: 'sticker', source: 'auto', label: 'eleve#0001', detail: '#general — « chat rigolo »' });
  st.settings.stickerGuard.enabled = true;
  st.stickerStats = { removed: 3, lastAt: new Date(Date.now() - 300e3).toISOString(), lastUser: 'eleve#0001', lastChannel: 'general', lastError: null };
  store.save(true);
}

require('../src/server');
console.log('DÉMO — aucune action n atteindra Discord');
