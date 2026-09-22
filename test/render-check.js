// Passe toutes les fonctions d affichage sur un état réel, avec un DOM minimal.
// Attrape les fautes de frappe et les accès à undefined sans navigateur.
//   node test/render-check.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PORT = process.env.PORT || 3998;

function get(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, res => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(JSON.parse(b)));
    }).on('error', reject);
  });
}

function makeEl(id) {
  const el = {
    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, checked: false,
    className: '', classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    contains: () => false, focus() {}, onclick: null, outerHTML: '',
  };
  return el;
}

const els = {};
const doc = {
  getElementById: id => (els[id] = els[id] || makeEl(id)),
  querySelector: sel => (sel.includes('base-path') ? { content: '/lock' } : makeEl('x')),
  querySelectorAll: () => [],
  createElement: () => makeEl('new'),
  addEventListener() {},
  activeElement: null,
  body: makeEl('body'),
};

async function main() {
  const state = await get('/lock/api/state');
  const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

  const sandbox = {
    document: doc,
    window: { scrollTo() {}, App: null },
    console,
    setInterval: () => 0,
    setTimeout: (fn) => 0,
    fetch: async (url) => ({
      ok: true,
      json: async () => {
        if (url.endsWith('/api/state')) return state;
        if (url.endsWith('/api/groups-detect')) return [];
        return { success: true, ok: 1, total: 1, results: [], errors: [] };
      },
    }),
    Intl, Date, Math, JSON, Set, Map, Number, String, Object, Array, Promise, RegExp, Error,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'app.js' });

  // laisse le load() initial se terminer
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  const App = sandbox.window.App;
  if (!App) throw new Error('App non exporté');

  const checks = [
    ['statTiles', /Salons fermés/],
    ['classCards', /class-card/],
    ['nextEvents', /rows|empty/],
    ['recentActivity', /feed|empty/],
    ['lockChannels', /class="ch /],
    ['lockRoles', /role-chip/],
    ['weekGrid', /class="week"/],
    ['schedList', /empty|sched/],
    ['groupCards', /class-card/],
    ['journalFeed', /feed-item|empty/],
    ['connectionBox', /row-item|field/],
    ['protChannels', /class="ch /],
    ['stickerChannels', /class="ch /],
    ['stickerRoles', /role-chip|Aucun/],
    ['stickerBanner', /.*/],
    ['globalBanner', /.*/],
  ];

  let bad = 0;
  for (const [id, re] of checks) {
    const html = els[id] ? els[id].innerHTML : '';
    const ok = re.test(html);
    if (!ok) { bad++; console.log(`  ✗ #${id} — contenu inattendu : ${JSON.stringify(html.slice(0, 90))}`); }
    else console.log(`  ✓ #${id} (${html.length} car.)`);
  }

  // les modales
  for (const open of [() => App.openGroup(state.groups[0]?.id), () => App.openGroup(),
                      () => App.openSchedule(), () => App.go('planning')]) {
    try { open(); } catch (e) { bad++; console.log(`  ✗ modale : ${e.message}`); }
  }
  if (els.modalBox && els.modalBox.innerHTML.includes('modal-head')) console.log('  ✓ modales rendues');
  else { bad++; console.log('  ✗ modale vide'); }

  console.log(bad ? `\n${bad} problème(s)` : '\nTout est rendu sans erreur.');
  process.exit(bad ? 1 : 0);
}

main().catch(e => { console.error('ÉCHEC :', e.stack); process.exit(1); });
