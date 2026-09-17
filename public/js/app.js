/* ───────────────────────────────────────────────────────────────────────────
   DachGuard — dashboard
   ─────────────────────────────────────────────────────────────────────────── */
const BASE = document.querySelector('meta[name="base-path"]')?.content || '';
const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const DAYS_LONG = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const S = {
  data: null,
  view: 'dashboard',
  sel: new Set(),          // salons cochés (vue Verrouillage)
  roleSel: new Set(),      // rôles cochés (vue Verrouillage)
  classFilter: null,
  lockedOnly: false,
  protSel: new Set(),
  modal: null,             // { type, draft } quand une modale est ouverte
  settingsDirty: false,
};

/* ─── Utilitaires ───────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const esc = str => String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${esc(msg)}</span>`;
  $('toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 220); }, 4200);
}

function timeAgo(iso) {
  const d = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (d < 45) return "à l'instant";
  if (d < 3600) return `il y a ${Math.floor(d / 60)} min`;
  if (d < 86400) return `il y a ${Math.floor(d / 3600)} h`;
  return `il y a ${Math.floor(d / 86400)} j`;
}

function timeUntil(iso) {
  const d = Math.floor((new Date(iso) - Date.now()) / 1000);
  if (d < 0) return 'maintenant';
  if (d < 60) return 'dans moins d’une minute';
  if (d < 3600) return `dans ${Math.floor(d / 60)} min`;
  if (d < 86400) return `dans ${Math.floor(d / 3600)} h ${Math.floor((d % 3600) / 60)} min`;
  return `dans ${Math.floor(d / 86400)} j`;
}

function tz() { return S.data?.settings?.timezone || 'Europe/Brussels'; }

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('fr-BE', {
    timeZone: tz(), weekday: 'short', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit',
  });
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('fr-BE', { timeZone: tz(), hour: '2-digit', minute: '2-digit' });
}

function zonedNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz(), weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { day: map[get('weekday')], minutes: +get('hour') * 60 + +get('minute') };
}

const toMin = t => { const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };

function channelById(id) { return (S.data?.channels || []).find(c => c.id === id); }
function roleById(id) { return (S.data?.roles || []).find(r => r.id === id); }
function groupById(id) { return (S.data?.groups || []).find(g => g.id === id); }
function isLocked(id) { return !!S.data?.locks?.[id]; }

/* ─── Chargement ────────────────────────────────────────────────────────── */
let firstLoad = true;

async function load() {
  try {
    const data = await api('/api/state');
    S.data = data;
    if (firstLoad) {
      firstLoad = false;
      S.protSel = new Set(data.settings.protectedChannelIds || []);
      if (data.groups[0]) data.groups[0].roleIds.forEach(r => S.roleSel.add(r));
      fillSettings();
    }
    render();
  } catch (e) {
    $('statusText').textContent = 'serveur injoignable';
  }
}

function render() {
  if (!S.data) return;
  renderStatus();
  renderBanner();
  renderDashboard();
  renderLockView();
  renderPlanning();
  renderGroups();
  renderJournal();
  renderConnection();
  renderProtected();
}

/* ─── Barre latérale ────────────────────────────────────────────────────── */
function renderStatus() {
  const d = S.data;
  const dot = $('statusDot'), txt = $('statusText'), nm = $('serverName'), av = $('serverAvatar');
  if (d.connected && d.guild) {
    dot.className = 'dot on';
    txt.textContent = `${d.channels.length} salons · ${d.roles.length} rôles`;
    nm.textContent = d.guild.name;
    if (d.guild.icon) { av.style.backgroundImage = `url(${d.guild.icon})`; av.textContent = ''; }
    else av.textContent = d.guild.name.slice(0, 1).toUpperCase();
  } else {
    dot.className = 'dot off';
    txt.textContent = d.hasToken ? 'reconnexion…' : 'hors ligne';
    nm.textContent = 'Non connecté';
    av.style.backgroundImage = ''; av.textContent = '?';
  }
  const badge = $('navLockedBadge');
  badge.textContent = d.lockedCount;
  badge.classList.toggle('hidden', !d.lockedCount);
}

function renderBanner() {
  const d = S.data;
  const box = $('globalBanner');
  const out = [];

  if (!d.connected) {
    out.push(`<div class="banner danger">
      <div class="row-icon">⚠️</div>
      <div class="grow">
        <h3>Le bot n'est pas connecté à Discord</h3>
        <p>${d.hasToken ? 'Un token est enregistré mais la connexion a échoué. Réessayez depuis les réglages.' : 'Collez le token du bot dans les réglages pour démarrer. Il sera retenu pour les prochains démarrages.'}</p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="App.go('reglages')">Réglages</button>
    </div>`);
  } else if (!d.groups.length) {
    out.push(`<div class="banner info">
      <div class="row-icon">🎓</div>
      <div class="grow">
        <h3>Aucune classe configurée</h3>
        <p>DachGuard peut reconnaître tout seul les rôles et salons de 3TIN et 4TIN.</p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="App.detectGroups()">Détecter</button>
    </div>`);
  } else if (d.guild && !d.guild.canManageRoles) {
    out.push(`<div class="banner warn">
      <div class="row-icon">🔑</div>
      <div class="grow"><h3>Permission manquante</h3>
      <p>Le bot n'a pas « Gérer les rôles » : il ne pourra pas modifier les permissions des salons.</p></div>
    </div>`);
  }
  box.innerHTML = out.join('');
}

/* ─── Tableau de bord ───────────────────────────────────────────────────── */
function renderDashboard() {
  const d = S.data;
  const activeSched = d.schedules.filter(s => s.effectiveActive).length;
  const runningSched = d.schedules.filter(s => s.running && s.effectiveActive).length;

  $('statTiles').innerHTML = `
    <div class="stat ${d.lockedCount ? 'danger' : 'success'}">
      <div class="label">Salons fermés</div>
      <div class="value">${d.lockedCount}<small> / ${d.channels.length}</small></div>
      <div class="hint">${d.lockedCount ? 'verrouillage en cours' : 'tout est ouvert'}</div>
    </div>
    <div class="stat">
      <div class="label">Classes</div>
      <div class="value">${d.groups.length}</div>
      <div class="hint">${d.groups.map(g => esc(g.name)).join(' · ') || 'aucune'}</div>
    </div>
    <div class="stat ${runningSched ? 'danger' : ''}">
      <div class="label">Planifications</div>
      <div class="value">${activeSched}<small> / ${d.schedules.length}</small></div>
      <div class="hint">${runningSched ? `${runningSched} créneau(x) en cours` : 'aucun créneau en cours'}</div>
    </div>
    <div class="stat warn">
      <div class="label">Prochaine action</div>
      <div class="value" style="font-size:19px">${d.nextEvent ? (d.nextEvent.kind === 'lock' ? '🔒 ' : '🔓 ') + fmtTime(d.nextEvent.at) : '—'}</div>
      <div class="hint">${d.nextEvent ? esc(d.nextEvent.name) + ' · ' + timeUntil(d.nextEvent.at) : 'rien de planifié'}</div>
    </div>`;

  $('classesHint').textContent = d.groups.length ? 'un clic ferme ou rouvre toute la classe' : '';

  $('classCards').innerHTML = d.groups.length ? d.groups.map(g => {
    const pct = g.total ? Math.round(g.lockedCount / g.total * 100) : 0;
    const roles = g.roleIds.map(id => roleById(id)).filter(Boolean);
    const sched = d.schedules.filter(s => s.groupId === g.id);
    return `<div class="class-card ${g.enabled ? '' : 'paused'}">
      <div class="class-top">
        <div class="class-emoji" style="border-color:${esc(g.color)}55;background:${esc(g.color)}1a">${esc(g.emoji || '🎓')}</div>
        <div>
          <div class="class-name">${esc(g.name)}</div>
          <div class="class-meta">${g.total} salons · ${sched.length} créneau${sched.length > 1 ? 'x' : ''}</div>
        </div>
        <div class="class-state">
          <span class="chip ${g.lockedCount ? 'danger' : 'on'}">${g.lockedCount ? `${g.lockedCount} fermé${g.lockedCount > 1 ? 's' : ''}` : 'ouvert'}</span>
        </div>
      </div>
      <div class="bar"><i style="width:${pct}%;background:${esc(g.color)}"></i></div>
      <div class="class-body">
        <div class="class-roles">
          ${roles.map(r => `<span class="chip chip-role" style="color:${esc(r.color)}">${esc(r.name)}</span>`).join('') || '<span class="chip warn">aucun rôle</span>'}
        </div>
        <div class="class-actions">
          <button class="btn btn-danger btn-sm" onclick="App.lockGroup('${g.id}')">Fermer</button>
          <button class="btn btn-ghost btn-sm" onclick="App.lockGroup('${g.id}', 50)">50 min</button>
          <button class="btn btn-success btn-sm" onclick="App.unlockGroup('${g.id}')">Rouvrir</button>
        </div>
        <label class="switch" style="margin-top:2px">
          <input type="checkbox" ${g.enabled ? 'checked' : ''} onchange="App.toggleGroup('${g.id}')">
          <span class="track"></span><span class="lbl faint">Planning actif</span>
        </label>
      </div>
    </div>`;
  }).join('') : `<div class="empty"><strong>Aucune classe</strong>Créez 3TIN et 4TIN pour piloter le serveur classe par classe.</div>`;

  // prochaines échéances
  const events = d.schedules
    .filter(s => s.effectiveActive && s.nextRun)
    .sort((a, b) => new Date(a.nextRun.at) - new Date(b.nextRun.at))
    .slice(0, 5);
  $('nextEvents').innerHTML = events.length ? `<div class="rows">${events.map(s => {
    const g = groupById(s.groupId);
    return `<div class="row-item">
      <div class="row-icon">${s.nextRun.kind === 'lock' ? '🔒' : '🔓'}</div>
      <div class="grow">
        <div class="t">${esc(s.name)}</div>
        <div class="s">${fmtDateTime(s.nextRun.at)} · ${timeUntil(s.nextRun.at)}</div>
      </div>
      ${g ? `<span class="chip" style="color:${esc(g.color)}">${esc(g.emoji || '')} ${esc(g.name)}</span>` : ''}
    </div>`;
  }).join('')}</div>` : `<div class="empty"><strong>Rien de planifié</strong>Ajoutez un créneau depuis l'onglet Planning.</div>`;

  $('recentActivity').innerHTML = feedHtml(d.activity.slice(0, 6));
}

function feedHtml(items) {
  if (!items.length) return `<div class="empty"><strong>Journal vide</strong>Les actions du bot s'inscriront ici.</div>`;
  const icons = { lock: '🔒', unlock: '🔓', schedule: '📅', error: '⚠️' };
  return `<div class="feed">${items.map(a => `
    <div class="feed-item ${esc(a.type)}">
      <div class="feed-dot">${icons[a.type] || '•'}</div>
      <div class="feed-body">
        <div class="feed-title">${a.type === 'lock' ? 'Fermeture' : a.type === 'unlock' ? 'Réouverture' : a.type === 'error' ? 'Échec' : 'Planning'}
          ${a.count ? `<span class="dim">— ${a.count} salon${a.count > 1 ? 's' : ''}</span>` : ''}
          ${a.label ? `<span class="dim">· ${esc(a.label)}</span>` : ''}</div>
        <div class="feed-meta">${timeAgo(a.at)} · ${fmtDateTime(a.at)} · ${esc(a.source || '')}</div>
        ${a.detail ? `<div class="feed-detail">${esc(a.detail)}</div>` : ''}
      </div>
    </div>`).join('')}</div>`;
}

/* ─── Vue Verrouillage ──────────────────────────────────────────────────── */
function renderLockView() {
  renderLockFilters();
  renderLockChannels();
  renderLockRoles();
}

function renderLockFilters() {
  const d = S.data;
  const f = $('lockFilters');
  f.innerHTML = [
    `<button class="chip chip-btn ${S.classFilter === null && !S.lockedOnly ? 'selected' : ''}" onclick="App.setFilter(null)">Tous</button>`,
    ...d.groups.map(g => `<button class="chip chip-btn ${S.classFilter === g.id ? 'selected' : ''}" onclick="App.setFilter('${g.id}')">${esc(g.emoji || '')} ${esc(g.name)}</button>`),
    `<button class="chip chip-btn ${S.lockedOnly ? 'selected' : ''}" onclick="App.toggleLockedOnly()">🔒 fermés</button>`,
  ].join('');
}

function visibleChannels() {
  const d = S.data;
  const q = ($('lockSearch')?.value || '').toLowerCase().trim();
  let list = d.channels;
  if (S.classFilter) {
    const g = groupById(S.classFilter);
    const ids = new Set(g ? g.channelIds : []);
    list = list.filter(c => ids.has(c.id));
  }
  if (S.lockedOnly) list = list.filter(c => isLocked(c.id));
  if (q) list = list.filter(c => c.name.toLowerCase().includes(q) || c.parentName.toLowerCase().includes(q));
  return list;
}

function channelRow(c, selected, onclick) {
  const lock = S.data.locks[c.id];
  const roles = lock ? Object.keys(lock.roles).map(id => roleById(id)?.name || '?') : [];
  const until = lock && Object.values(lock.roles).find(r => r.until)?.until;
  const kindIcon = c.kind === 'voice' ? '🔊' : c.kind === 'forum' ? '💬' : c.kind === 'announcement' ? '📣' : '#';
  return `<div class="ch ${selected ? 'selected' : ''} ${lock ? 'locked' : ''}" onclick="${onclick}">
    <div class="box"></div>
    <span class="hash">${kindIcon === '#' ? '#' : kindIcon}</span>
    <span class="nm">${esc(c.name)}</span>
    <span class="tags">
      ${c.protected ? '<span class="mini" title="salon protégé">🛡</span>' : ''}
      ${c.isTicket ? '<span class="mini" title="masqué au lieu d\'être mis en lecture seule">🎫</span>' : ''}
      ${lock ? `<span class="chip danger mono" title="${esc(roles.join(', '))}">🔒${until ? ' ' + fmtTime(until) : ''}</span>` : ''}
    </span>
  </div>`;
}

function renderLockChannels() {
  const list = visibleChannels();
  const box = $('lockChannels');
  if (!list.length) { box.innerHTML = `<div class="empty">Aucun salon ne correspond.</div>`; updateSelCount(); return; }

  const cats = [];
  for (const c of list) {
    let cat = cats.find(x => x.name === c.parentName);
    if (!cat) { cat = { name: c.parentName, items: [] }; cats.push(cat); }
    cat.items.push(c);
  }
  box.innerHTML = cats.map(cat => `
    <div class="cat-head">
      <span>${esc(cat.name)}</span><span class="line"></span>
      <button onclick="App.selectCat('${esc(cat.name).replace(/'/g, "\\'")}', true)">tout</button>
      <button onclick="App.selectCat('${esc(cat.name).replace(/'/g, "\\'")}', false)">rien</button>
    </div>
    ${cat.items.map(c => channelRow(c, S.sel.has(c.id), `App.toggleChannel('${c.id}')`)).join('')}
  `).join('');
  updateSelCount();
}

function updateSelCount() {
  const n = S.sel.size;
  $('lockSelCount').textContent = `${n} sélectionné${n > 1 ? 's' : ''}`;
}

function renderLockRoles() {
  const d = S.data;
  $('lockRoles').innerHTML = d.roles.map(r => `
    <button class="role-chip ${S.roleSel.has(r.id) ? 'selected' : ''} ${r.manageable ? '' : 'locked-out'}"
            onclick="App.toggleRole('${r.id}')" title="${r.manageable ? '' : 'Ce rôle est au-dessus du bot dans la hiérarchie'}">
      <span class="dotc" style="background:${esc(r.color)}"></span>${esc(r.name)}${r.admin ? ' 👑' : ''}${r.manageable ? '' : ' ⛔'}
    </button>`).join('') || '<span class="faint">Aucun rôle</span>';

  const bad = [...S.roleSel].map(roleById).filter(r => r && !r.manageable);
  $('lockRoleHint').innerHTML = bad.length
    ? `<span style="color:var(--warn)">⚠ ${bad.map(r => esc(r.name)).join(', ')} — le bot ne peut pas modifier un rôle placé au-dessus du sien.</span>`
    : 'Les rôles 👑 administrateurs passent outre tout verrou.';
}

/* ─── Planning ──────────────────────────────────────────────────────────── */
function renderPlanning() {
  const d = S.data;
  const now = zonedNow();
  $('weekHint').textContent = `fuseau ${tz()} · ${DAYS_LONG[now.day]} ${String(Math.floor(now.minutes / 60)).padStart(2, '0')}:${String(now.minutes % 60).padStart(2, '0')}`;

  // blocs par jour
  const perDay = {}; WEEK_ORDER.forEach(d2 => perDay[d2] = []);
  for (const s of d.schedules) {
    const g = groupById(s.groupId);
    const color = g ? g.color : '#5865f2';
    const start = toMin(s.startTime), end = toMin(s.endTime);
    for (const day of s.days) {
      if (end > start) {
        perDay[day].push({ s, color, from: start, to: end, label: s.startTime });
      } else {
        perDay[day].push({ s, color, from: start, to: 1440, label: s.startTime });
        perDay[(day + 1) % 7].push({ s, color, from: 0, to: end, label: '↳' });
      }
    }
  }

  const hours = [0, 3, 6, 9, 12, 15, 18, 21].map(h => `<span>${String(h).padStart(2, '0')}h</span>`).join('');
  $('weekGrid').innerHTML = `<div class="week">
    <div class="head"></div>
    ${WEEK_ORDER.map(day => `<div class="head ${day === now.day ? 'today' : ''}">${DAYS[day]}</div>`).join('')}
    <div class="hours">${hours}</div>
    ${WEEK_ORDER.map(day => `
      <div class="col">
        <div class="grid-lines">${'<i></i>'.repeat(8)}</div>
        ${day === now.day ? `<div class="now" style="top:${(now.minutes / 1440 * 100).toFixed(2)}%"></div>` : ''}
        ${perDay[day].map(b => `
          <div class="blk" style="top:${(b.from / 1440 * 100).toFixed(2)}%;height:${Math.max(2.2, (b.to - b.from) / 1440 * 100).toFixed(2)}%;background:${esc(b.color)}cc;border-left-color:${esc(b.color)}"
               title="${esc(b.s.name)} — ${b.s.startTime} → ${b.s.endTime}" onclick="App.openSchedule('${b.s.id}')">${esc(b.label)}</div>`).join('')}
      </div>`).join('')}
  </div>`;

  $('schedCount').textContent = `${d.schedules.length} créneau${d.schedules.length > 1 ? 'x' : ''}`;
  $('schedList').innerHTML = d.schedules.length ? `<div class="rows">${d.schedules.map(schedCard).join('')}</div>`
    : `<div class="empty"><strong>Aucun créneau</strong>Par exemple : fermer les salons 3TIN du lundi au vendredi de 22h à 7h.</div>`;
}

function schedCard(s) {
  const g = groupById(s.groupId);
  const chans = (s.targets?.channelIds || []).length;
  return `<div class="sched ${s.effectiveActive ? '' : 'inactive'} ${s.running ? 'running' : ''}">
    <div class="sched-time">
      <div class="h">${esc(s.startTime)}</div>
      <div class="sep">▼</div>
      <div class="h">${esc(s.endTime)}</div>
    </div>
    <div class="sched-info">
      <h3>${esc(s.name)} ${s.running ? '<span class="chip danger">en cours</span>' : ''}</h3>
      <div class="sched-tags">
        ${g ? `<span class="chip" style="color:${esc(g.color)}">${esc(g.emoji || '')} ${esc(g.name)}</span>` : '<span class="chip">cibles manuelles</span>'}
        ${s.days.map(d => `<span class="chip mono">${DAYS[d]}</span>`).join('')}
        ${s.overnight ? '<span class="chip warn">passe minuit</span>' : ''}
        <span class="chip mono">${chans} salon${chans > 1 ? 's' : ''}</span>
        ${s.lockMessage ? `<span class="chip">💬 ${esc(s.lockMessage.slice(0, 40))}</span>` : ''}
      </div>
      <div class="s dim mono" style="margin-top:6px;font-size:11px">
        ${s.nextRun ? `prochain : ${s.nextRun.kind === 'lock' ? 'fermeture' : 'réouverture'} ${fmtDateTime(s.nextRun.at)}` : 'inactif'}
        ${s.lastLocked ? ` · dernière fermeture ${timeAgo(s.lastLocked)}` : ''}
      </div>
    </div>
    <div class="sched-acts">
      <button class="btn btn-ghost btn-sm" onclick="App.openSchedule('${s.id}')">Modifier</button>
      <button class="btn btn-ghost btn-sm" onclick="App.toggleSchedule('${s.id}')">${s.active ? 'Désactiver' : 'Activer'}</button>
      <button class="btn btn-ghost btn-sm" onclick="App.deleteSchedule('${s.id}')">Supprimer</button>
    </div>
  </div>`;
}

/* ─── Classes ───────────────────────────────────────────────────────────── */
function renderGroups() {
  const d = S.data;
  $('groupCards').innerHTML = d.groups.length ? d.groups.map(g => {
    const roles = g.roleIds.map(roleById).filter(Boolean);
    return `<div class="class-card ${g.enabled ? '' : 'paused'}">
      <div class="class-top">
        <div class="class-emoji" style="border-color:${esc(g.color)}55;background:${esc(g.color)}1a">${esc(g.emoji || '🎓')}</div>
        <div><div class="class-name">${esc(g.name)}</div>
        <div class="class-meta">${g.channelIds.length} salons · ${g.roleIds.length} rôles</div></div>
      </div>
      <div class="class-body">
        <div class="class-roles">
          ${roles.map(r => `<span class="chip chip-role" style="color:${esc(r.color)}">${esc(r.name)}</span>`).join('') || '<span class="chip warn">aucun rôle</span>'}
        </div>
        <div class="class-roles">
          ${g.channelIds.slice(0, 6).map(id => `<span class="chip mono">#${esc(channelById(id)?.name || '?')}</span>`).join('')}
          ${g.channelIds.length > 6 ? `<span class="chip mono">+${g.channelIds.length - 6}</span>` : ''}
        </div>
        <div class="class-actions">
          <button class="btn btn-ghost btn-sm" onclick="App.openGroup('${g.id}')">Modifier</button>
          <button class="btn btn-ghost btn-sm" onclick="App.deleteGroup('${g.id}')">Supprimer</button>
        </div>
      </div>
    </div>`;
  }).join('') : `<div class="empty"><strong>Aucune classe</strong>Lancez la détection automatique : DachGuard reconnaît « 3TIN », « 4TTI », « (3ème) »…</div>`;
}

/* ─── Journal ───────────────────────────────────────────────────────────── */
function renderJournal() {
  $('journalFeed').innerHTML = feedHtml(S.data.activity || []);
}

/* ─── Réglages ──────────────────────────────────────────────────────────── */
function fillSettings() {
  const st = S.data.settings;
  $('setDefaultMessage').value = st.defaultLockMessage || '';
  $('setTimezone').value = st.timezone;
  $('setStrict').checked = !!st.strictLock;
  $('setAnnounceLock').checked = !!st.announceLock;
  $('setAnnounceUnlock').checked = !!st.announceUnlock;
  $('setSlash').checked = !!st.slashCommands;
}

function renderConnection() {
  const d = S.data;
  const box = $('connectionBox');
  // ne pas effacer le token en cours de frappe lors d'un rafraîchissement
  if (box.contains(document.activeElement)) return;
  if (d.connected) {
    box.innerHTML = `
      <div class="row-item">
        <div class="row-icon">🤖</div>
        <div class="grow">
          <div class="t">${esc(d.guild.botTag || 'bot')} — connecté à ${esc(d.guild.name)}</div>
          <div class="s">${d.guild.memberCount} membres · depuis ${d.connectedAt ? timeAgo(d.connectedAt) : '—'} · token ${d.hasToken ? 'enregistré' : 'non enregistré'}</div>
        </div>
        <span class="chip on">en ligne</span>
      </div>`;
  } else {
    box.innerHTML = `
      ${d.lastError ? `<div class="banner danger" style="margin-bottom:12px"><div class="grow"><p>${esc(d.lastError)}</p></div></div>` : ''}
      <div class="field">
        <label>Token du bot Discord</label>
        <input type="password" id="tokenInput" placeholder="MTxxxxxxxx.xxxxxx.xxxxxxxxxxxxxxxxxx" autocomplete="off">
        <div class="help">Enregistré sur le serveur (fichier <span class="mono">data/state.json</span>, lisible par vous seul) pour que le bot se reconnecte tout seul après un redémarrage.</div>
      </div>
      <div class="mt"><button class="btn btn-primary" onclick="App.connect()">Connecter le bot</button>
      ${d.hasToken ? `<button class="btn btn-ghost" style="margin-left:8px" onclick="App.connect(true)">Réessayer avec le token enregistré</button>` : ''}</div>`;
  }

  const sl = d.slash || {};
  $('slashInfo').innerHTML = d.connected
    ? (sl.ok
      ? `<span class="chip on">✓ ${sl.count} commandes Discord enregistrées</span>`
      : `<span class="chip warn">Commandes Discord indisponibles — ${esc(sl.reason || '')}</span>
         <div class="help mt-sm">Si Discord répond « Missing Access », réinvitez le bot avec le scope <span class="mono">applications.commands</span>.</div>`)
    : '';
}

function renderProtected() {
  const q = ($('protSearch')?.value || '').toLowerCase().trim();
  const list = (S.data.channels || []).filter(c => !q || c.name.toLowerCase().includes(q) || c.parentName.toLowerCase().includes(q));
  const box = $('protChannels');
  if (!list.length) { box.innerHTML = '<div class="empty">Aucun salon</div>'; return; }
  const cats = [];
  for (const c of list) {
    let cat = cats.find(x => x.name === c.parentName);
    if (!cat) { cat = { name: c.parentName, items: [] }; cats.push(cat); }
    cat.items.push(c);
  }
  box.innerHTML = cats.map(cat => `
    <div class="cat-head"><span>${esc(cat.name)}</span><span class="line"></span></div>
    ${cat.items.map(c => channelRow(c, S.protSel.has(c.id), `App.toggleProtected('${c.id}')`)).join('')}`).join('');
}

/* ─── Modales ───────────────────────────────────────────────────────────── */
function openModal(html, cls = '') {
  $('modalBox').className = `modal ${cls}`;
  $('modalBox').innerHTML = html;
  $('overlay').classList.add('open');
}
function closeModal() {
  $('overlay').classList.remove('open');
  S.modal = null;
  render();
}

function askConfirm(title, text, danger = true) {
  return new Promise(resolve => {
    S.modal = { type: 'confirm' };
    openModal(`
      <div class="modal-head"><div><h2>${esc(title)}</h2><p>${esc(text)}</p></div></div>
      <div class="modal-foot">
        <button class="btn btn-ghost" id="cfNo">Annuler</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="cfYes">Confirmer</button>
      </div>`, 'sm');
    $('cfNo').onclick = () => { closeModal(); resolve(false); };
    $('cfYes').onclick = () => { closeModal(); resolve(true); };
  });
}

/* Sélecteurs réutilisables dans les modales */
function pickerChannels(selected, fnName) {
  const cats = [];
  for (const c of S.data.channels) {
    let cat = cats.find(x => x.name === c.parentName);
    if (!cat) { cat = { name: c.parentName, items: [] }; cats.push(cat); }
    cat.items.push(c);
  }
  return `<div class="picker"><div class="picker-list short">${cats.map(cat => `
    <div class="cat-head"><span>${esc(cat.name)}</span><span class="line"></span>
      <button onclick="${fnName}Cat('${esc(cat.name).replace(/'/g, "\\'")}', true)">tout</button>
      <button onclick="${fnName}Cat('${esc(cat.name).replace(/'/g, "\\'")}', false)">rien</button></div>
    ${cat.items.map(c => channelRow(c, selected.has(c.id), `${fnName}('${c.id}')`)).join('')}`).join('')}</div></div>`;
}

function pickerRoles(selected, fnName) {
  return `<div class="role-picker">${S.data.roles.map(r => `
    <button class="role-chip ${selected.has(r.id) ? 'selected' : ''}" onclick="${fnName}('${r.id}')">
      <span class="dotc" style="background:${esc(r.color)}"></span>${esc(r.name)}
    </button>`).join('')}</div>`;
}

/* ─── API publique (appelée depuis le HTML) ─────────────────────────────── */
const App = {
  go(view) {
    S.view = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    $(`view-${view}`).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  async refreshNow() {
    await api('/api/refresh', { method: 'POST' }).catch(() => {});
    await load();
    toast('Données rafraîchies');
  },

  /* — sélection — */
  toggleChannel(id) { S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); renderLockChannels(); },
  selectCat(name, on) {
    visibleChannels().filter(c => c.parentName === name).forEach(c => on ? S.sel.add(c.id) : S.sel.delete(c.id));
    renderLockChannels();
  },
  toggleRole(id) { S.roleSel.has(id) ? S.roleSel.delete(id) : S.roleSel.add(id); renderLockRoles(); },
  setFilter(id) {
    S.classFilter = id; S.lockedOnly = false;
    if (id) { const g = groupById(id); S.sel = new Set(g.channelIds); S.roleSel = new Set(g.roleIds); }
    renderLockView();
  },
  toggleLockedOnly() { S.lockedOnly = !S.lockedOnly; S.classFilter = null; renderLockView(); },
  setDuration(v) { $('lockDuration').value = v ?? ''; },
  toggleProtected(id) { S.protSel.has(id) ? S.protSel.delete(id) : S.protSel.add(id); renderProtected(); },

  /* — actions immédiates — */
  async lockNow() {
    if (!S.sel.size) return toast('Sélectionnez au moins un salon', 'error');
    if (!S.roleSel.size) return toast('Sélectionnez au moins un rôle', 'error');
    const raw = $('lockMessage').value.trim();
    const payload = {
      channelIds: [...S.sel], roleIds: [...S.roleSel],
      mode: $('lockMode').value,
      durationMinutes: Number($('lockDuration').value) || null,
    };
    if (raw === '-') payload.message = '';
    else if (raw) payload.message = raw;
    try {
      const r = await api('/api/lock', { method: 'POST', body: payload });
      toast(`🔒 ${r.ok}/${r.total} salons fermés`, r.ok === r.total ? 'success' : 'error');
      if (r.errors.length) toast(r.errors[0], 'error');
      await load();
    } catch (e) { toast(e.message, 'error'); }
  },

  async unlockNow(restore = 'restore') {
    if (!S.sel.size) return toast('Sélectionnez au moins un salon', 'error');
    try {
      const r = await api('/api/unlock', {
        method: 'POST',
        body: { channelIds: [...S.sel], roleIds: [...S.roleSel], restore },
      });
      toast(`🔓 ${r.ok}/${r.total} salons rouverts`, 'success');
      if (r.errors.length) toast(r.errors[0], 'error');
      await load();
    } catch (e) { toast(e.message, 'error'); }
  },

  async diagnose() {
    if (!S.sel.size) return toast('Sélectionnez des salons à vérifier', 'error');
    try {
      const r = await api('/api/diagnose', {
        method: 'POST',
        body: { channelIds: [...S.sel], roleIds: [...S.roleSel], mode: $('lockMode').value },
      });
      const out = [];
      if (r.unmanageable.length) {
        out.push(`<div class="banner danger"><div class="grow"><h3>Rôles hors de portée</h3>
          <p>${r.unmanageable.map(x => esc(x.name)).join(', ')} — placez le rôle du bot au-dessus dans Discord.</p></div></div>`);
      }
      if (r.report.length) {
        out.push(`<div class="banner warn"><div class="grow"><h3>Autorisations qui contournent le verrou</h3>
          <p>${r.report.slice(0, 6).map(x => `<b>#${esc(x.channelName)}</b> : ${x.leaks.map(l => esc(l.name)).join(', ')}`).join('<br>')}</p>
          <p class="mt-sm faint">Ces rôles gardent la parole car le salon leur accorde explicitement le droit d'écrire. Ajoutez-les aux rôles ciblés si besoin.</p></div></div>`);
      }
      if (r.admins.length) {
        out.push(`<div class="banner info"><div class="grow"><h3>Immunisés</h3>
          <p>${r.admins.map(a => esc(a.name)).join(', ')} — administrateurs, ils passent partout.</p></div></div>`);
      }
      if (!out.length) out.push(`<div class="banner"><div class="grow"><h3>✓ Rien à signaler</h3><p>Le verrou tiendra pour les rôles choisis.</p></div></div>`);
      $('diagnoseOut').innerHTML = out.join('');
    } catch (e) { toast(e.message, 'error'); }
  },

  async lockGroup(id, minutes) {
    const g = groupById(id);
    const ok = await askConfirm(
      minutes ? `Fermer ${g.name} pour ${minutes} min ?` : `Fermer les salons de ${g.name} ?`,
      `${g.channelIds.length} salons seront mis en lecture seule pour ${g.roleIds.map(r => roleById(r)?.name || '?').join(', ')}.`);
    if (!ok) return;
    try {
      const r = await api(`/api/groups/${id}/lock`, { method: 'POST', body: { durationMinutes: minutes || null } });
      toast(`🔒 ${g.name} — ${r.ok}/${r.total} salons fermés`, 'success');
      if (r.errors.length) toast(r.errors[0], 'error');
      await load();
    } catch (e) { toast(e.message, 'error'); }
  },

  async unlockGroup(id) {
    const g = groupById(id);
    try {
      const r = await api(`/api/groups/${id}/unlock`, { method: 'POST', body: { restore: 'restore' } });
      toast(`🔓 ${g.name} — ${r.ok}/${r.total} salons rouverts`, 'success');
      await load();
    } catch (e) { toast(e.message, 'error'); }
  },

  async toggleGroup(id) {
    try { await api(`/api/groups/${id}/toggle`, { method: 'PATCH' }); await load(); }
    catch (e) { toast(e.message, 'error'); }
  },

  async panic() {
    const ok = await askConfirm('Fermer tout le serveur ?',
      'Tous les salons sauf ceux protégés seront verrouillés pour les rôles de toutes les classes.');
    if (!ok) return;
    try {
      const r = await api('/api/panic', { method: 'POST', body: {} });
      toast(`🔒 ${r.ok} salons fermés`, 'success');
      await load();
    } catch (e) { toast(e.message, 'error'); }
  },

  async releaseAll() {
    const ok = await askConfirm('Tout rouvrir ?', 'Chaque salon retrouve les permissions qu’il avait avant son verrouillage.', false);
    if (!ok) return;
    try {
      const r = await api('/api/release-all', { method: 'POST', body: { restore: 'restore' } });
      toast(`🔓 ${r.ok} salons rouverts`, 'success');
      await load();
    } catch (e) { toast(e.message, 'error'); }
  },

  /* — connexion — */
  async connect(useStored = false) {
    const token = useStored ? null : ($('tokenInput')?.value || '').trim();
    if (!useStored && !token) return toast('Collez le token du bot', 'error');
    toast('Connexion à Discord…');
    try {
      await api('/api/connect', { method: 'POST', body: { token, remember: true } });
      toast('✅ Bot connecté', 'success');
      firstLoad = true;
      await load();
    } catch (e) { toast(e.message, 'error'); await load(); }
  },

  async disconnect(forget) {
    const ok = await askConfirm(forget ? 'Oublier le token ?' : 'Déconnecter le bot ?',
      forget ? 'Le bot se déconnecte et le token est effacé du serveur.' : 'Les verrous en place restent, mais plus rien ne sera appliqué.');
    if (!ok) return;
    await api('/api/disconnect', { method: 'POST', body: { forget } });
    toast('Bot déconnecté');
    await load();
  },

  /* — réglages — */
  async saveSettings() {
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: {
          defaultLockMessage: $('setDefaultMessage').value,
          timezone: $('setTimezone').value,
          strictLock: $('setStrict').checked,
          announceLock: $('setAnnounceLock').checked,
          announceUnlock: $('setAnnounceUnlock').checked,
          slashCommands: $('setSlash').checked,
        },
      });
      toast('Réglages enregistrés', 'success');
      await load();
    } catch (e) { toast(e.message, 'error'); }
  },

  async saveProtected() {
    try {
      await api('/api/settings', { method: 'PUT', body: { protectedChannelIds: [...S.protSel] } });
      toast(`${S.protSel.size} salons protégés`, 'success');
      await load();
    } catch (e) { toast(e.message, 'error'); }
  },

  renderLockChannels, renderProtected,

  /* — classes — */
  async detectGroups() {
    try {
      const props = await api('/api/groups-detect');
      if (!props.length) return toast('Aucune classe reconnue dans les noms de rôles et de salons', 'error');
      const ok = await askConfirm('Appliquer la détection ?',
        props.map(p => `${p.name} : ${p.roleIds.length} rôle, ${p.channelIds.length} salons`).join(' — '), false);
      if (!ok) return;
      const r = await api('/api/groups-detect', { method: 'POST', body: {} });
      toast(`✅ ${r.groups.length} classe(s) configurée(s)`, 'success');
      await load();
    } catch (e) { toast(e.message, 'error'); }
  },

  openGroup(id) {
    const g = id ? groupById(id) : null;
    const draft = {
      channels: new Set(g ? g.channelIds : []),
      roles: new Set(g ? g.roleIds : []),
    };
    S.modal = { type: 'group', id, draft };
    openModal(`
      <div class="modal-head">
        <div><h2>${g ? 'Modifier la classe' : 'Nouvelle classe'}</h2>
        <p>Les rôles à qui on retire la parole, et les salons concernés.</p></div>
        <button class="modal-close" onclick="App.closeModal()">✕</button>
      </div>
      <div class="row">
        <div class="field" style="flex:0 0 70px;min-width:70px"><label>Emoji</label>
          <input type="text" id="gEmoji" maxlength="4" value="${esc(g?.emoji || '🎓')}"></div>
        <div class="field"><label>Nom</label><input type="text" id="gName" value="${esc(g?.name || '')}" placeholder="3TIN"></div>
        <div class="field" style="flex:0 0 70px;min-width:70px"><label>Couleur</label>
          <input type="color" id="gColor" value="${esc(g?.color || '#5865f2')}"></div>
      </div>
      <div class="field"><label>Message par défaut (optionnel)</label>
        <input type="text" id="gMessage" value="${esc(g?.defaultMessage || '')}" placeholder="Salon fermé pendant le cours."></div>
      <div class="field"><label>Rôles</label>${pickerRoles(draft.roles, 'App.mRole')}</div>
      <div class="field"><label>Salons</label>${pickerChannels(draft.channels, 'App.mChan')}</div>
      <div class="modal-foot">
        <button class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
        <button class="btn btn-primary" onclick="App.saveGroup()">${g ? 'Enregistrer' : 'Créer la classe'}</button>
      </div>`);
  },

  mChan(id) {
    const d = S.modal.draft.channels;
    d.has(id) ? d.delete(id) : d.add(id);
    App.refreshModalPickers();
  },
  mChanCat(name, on) {
    S.data.channels.filter(c => c.parentName === name)
      .forEach(c => on ? S.modal.draft.channels.add(c.id) : S.modal.draft.channels.delete(c.id));
    App.refreshModalPickers();
  },
  mRole(id) {
    const d = S.modal.draft.roles;
    d.has(id) ? d.delete(id) : d.add(id);
    App.refreshModalPickers();
  },
  refreshModalPickers() {
    const box = $('modalBox');
    const chan = box.querySelector('.picker');
    const roles = box.querySelector('.role-picker');
    if (roles) roles.outerHTML = pickerRoles(S.modal.draft.roles, 'App.mRole');
    if (chan) chan.outerHTML = pickerChannels(S.modal.draft.channels, 'App.mChan');
  },

  async saveGroup() {
    const body = {
      name: $('gName').value.trim(),
      emoji: $('gEmoji').value.trim(),
      color: $('gColor').value,
      defaultMessage: $('gMessage').value.trim(),
      roleIds: [...S.modal.draft.roles],
      channelIds: [...S.modal.draft.channels],
    };
    if (!body.name) return toast('Donnez un nom à la classe', 'error');
    try {
      if (S.modal.id) await api(`/api/groups/${S.modal.id}`, { method: 'PUT', body });
      else await api('/api/groups', { method: 'POST', body });
      toast('Classe enregistrée', 'success');
      closeModal();
      await load();
    } catch (e) { toast(e.message, 'error'); }
  },

  async deleteGroup(id) {
    const g = groupById(id);
    if (!await askConfirm(`Supprimer ${g.name} ?`, 'Les planifications liées deviendront « cibles manuelles ».')) return;
    try { await api(`/api/groups/${id}`, { method: 'DELETE' }); toast('Classe supprimée'); await load(); }
    catch (e) { toast(e.message, 'error'); }
  },

  /* — planifications — */
  openSchedule(id) {
    const s = id ? S.data.schedules.find(x => x.id === id) : null;
    const draft = {
      days: new Set(s ? s.days : [1, 2, 3, 4, 5]),
      channels: new Set(s ? s.channelIds : []),
      roles: new Set(s ? s.roleIds : []),
      custom: !!(s && (s.channelIds.length || s.roleIds.length)),
    };
    S.modal = { type: 'schedule', id, draft };
    openModal(`
      <div class="modal-head">
        <div><h2>${s ? 'Modifier le créneau' : 'Nouveau créneau'}</h2>
        <p>Chaque semaine aux mêmes heures. Une fin plus tôt que le début signifie « jusqu'au lendemain matin ».</p></div>
        <button class="modal-close" onclick="App.closeModal()">✕</button>
      </div>
      <div class="row">
        <div class="field"><label>Nom (optionnel)</label>
          <input type="text" id="sName" value="${esc(s?.name || '')}" placeholder="Nuit 3TIN"></div>
        <div class="field"><label>Classe</label>
          <select id="sGroup">
            <option value="">— cibles manuelles —</option>
            ${S.data.groups.map(g => `<option value="${g.id}" ${s?.groupId === g.id ? 'selected' : ''}>${esc(g.emoji || '')} ${esc(g.name)}</option>`).join('')}
          </select></div>
      </div>
      <div class="field"><label>Jours</label>
        <div class="days" id="sDays">${WEEK_ORDER.map(d => `
          <button class="day-btn ${draft.days.has(d) ? 'on' : ''}" onclick="App.mDay(${d})" id="day${d}">${DAYS[d]}</button>`).join('')}</div>
      </div>
      <div class="row">
        <div class="field"><label>Fermeture</label><input type="time" id="sStart" value="${esc(s?.startTime || '22:00')}"></div>
        <div class="field"><label>Réouverture</label><input type="time" id="sEnd" value="${esc(s?.endTime || '07:00')}"></div>
        <div class="field"><label>Mode</label>
          <select id="sMode">
            <option value="auto" ${s?.mode === 'auto' || !s ? 'selected' : ''}>Auto</option>
            <option value="write" ${s?.mode === 'write' ? 'selected' : ''}>Lecture seule</option>
            <option value="hide" ${s?.mode === 'hide' ? 'selected' : ''}>Masquer</option>
          </select></div>
      </div>
      <div class="field"><label>Message affiché (vide = message par défaut)</label>
        <input type="text" id="sMessage" value="${esc(s?.lockMessage || '')}" placeholder="Bonne nuit — les salons rouvrent à 7h."></div>
      <div class="field">
        <label class="switch" style="margin-top:6px">
          <input type="checkbox" id="sCustom" ${draft.custom ? 'checked' : ''} onchange="App.mToggleCustom()">
          <span class="track"></span><span class="lbl">Cibler des salons et rôles précis (sinon : ceux de la classe)</span>
        </label>
      </div>
      <div id="sCustomBox" class="${draft.custom ? '' : 'hidden'}">
        <div class="field"><label>Rôles</label>${pickerRoles(draft.roles, 'App.mRole')}</div>
        <div class="field"><label>Salons</label>${pickerChannels(draft.channels, 'App.mChan')}</div>
      </div>
      <div class="modal-foot">
        ${s ? `<button class="btn btn-ghost" onclick="App.runSchedule('${s.id}','lock')">Tester la fermeture</button>` : ''}
        <button class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
        <button class="btn btn-primary" onclick="App.saveSchedule()">${s ? 'Enregistrer' : 'Créer le créneau'}</button>
      </div>`);
  },

  mDay(d) {
    const set = S.modal.draft.days;
    set.has(d) ? set.delete(d) : set.add(d);
    $(`day${d}`).classList.toggle('on', set.has(d));
  },
  mToggleCustom() {
    S.modal.draft.custom = $('sCustom').checked;
    $('sCustomBox').classList.toggle('hidden', !S.modal.draft.custom);
  },

  async saveSchedule() {
    const d = S.modal.draft;
    const body = {
      name: $('sName').value.trim(),
      groupId: $('sGroup').value || null,
      days: [...d.days],
      startTime: $('sStart').value,
      endTime: $('sEnd').value,
      mode: $('sMode').value,
      lockMessage: $('sMessage').value,
      channelIds: d.custom ? [...d.channels] : [],
      roleIds: d.custom ? [...d.roles] : [],
    };
    try {
      if (S.modal.id) await api(`/api/schedules/${S.modal.id}`, { method: 'PUT', body });
      else await api('/api/schedules', { method: 'POST', body });
      toast('Créneau enregistré', 'success');
      closeModal();
      await load();
    } catch (e) { toast(e.message, 'error'); }
  },

  async toggleSchedule(id) {
    try { await api(`/api/schedules/${id}/toggle`, { method: 'PATCH' }); await load(); }
    catch (e) { toast(e.message, 'error'); }
  },

  async deleteSchedule(id) {
    const s = S.data.schedules.find(x => x.id === id);
    if (!await askConfirm('Supprimer ce créneau ?', s.name)) return;
    try { await api(`/api/schedules/${id}`, { method: 'DELETE' }); toast('Créneau supprimé'); await load(); }
    catch (e) { toast(e.message, 'error'); }
  },

  async runSchedule(id, action) {
    try {
      const r = await api(`/api/schedules/${id}/run`, { method: 'POST', body: { action } });
      toast(`${action === 'lock' ? '🔒' : '🔓'} ${r.ok}/${r.total} salons`, 'success');
      closeModal();
      await load();
    } catch (e) { toast(e.message, 'error'); }
  },

  closeModal,
  onOverlayClick(e) { if (e.target === $('overlay')) closeModal(); },
};

window.App = App;

/* ─── Démarrage ─────────────────────────────────────────────────────────── */
document.getElementById('nav').addEventListener('click', e => {
  const btn = e.target.closest('.nav-item');
  if (btn) App.go(btn.dataset.view);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('overlay').classList.contains('open')) closeModal();
});

load();
setInterval(() => { if (!$('overlay').classList.contains('open')) load(); }, 6000);
