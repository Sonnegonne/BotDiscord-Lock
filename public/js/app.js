// ─── STATE ──────────────────────────────────────────────────────────────────
let state = {
  connected: false,
  guild: null,
  channels: [],
  roles: [],
  schedules: [],
  defaultRoleId: null,
  channelStates: {},
  sectionStates: { vie_privee: true, cours: true },
};

// ─── INIT ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  pollStatus();
  setInterval(pollStatus, 8000);
  setInterval(loadChannelStates, 10000);
});

async function pollStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    updateStatus(data);
  } catch (e) {}
}

function updateStatus(data) {
  const pill = document.getElementById('statusPill');
  const statusText = document.getElementById('statusText');

  if (data.connected && data.guild) {
    state.connected = true;
    state.guild = data.guild;
    state.channels = data.channels || [];
    state.roles = data.roles || [];
    state.defaultRoleId = data.defaultRoleId || null;

    pill.classList.add('connected');
    statusText.textContent = data.guild.name;

    document.getElementById('serverPanel').style.display = '';
    document.getElementById('defaultRolePanel').style.display = '';
    document.getElementById('channelStatesPanel').style.display = '';
    document.getElementById('immediatePanel').style.display = '';
    document.getElementById('schedulePanel').style.display = '';
    document.getElementById('schedulesListPanel').style.display = '';

    document.getElementById('serverName').textContent = data.guild.name;
    document.getElementById('channelCount').textContent = `${data.channels.length} channels`;
    document.getElementById('roleCount').textContent = `${data.roles.length} rôles`;

    const avatar = document.getElementById('serverAvatar');
    if (data.guild.icon) avatar.style.backgroundImage = `url(${data.guild.icon})`;

    renderChannels('quickChannels');
    renderChannels('schedChannels');
    renderRoles('quickRole');
    renderRoles('schedRole');
    renderRoles('defaultRoleSelect');

    if (state.defaultRoleId) {
      document.getElementById('defaultRoleSelect').value = state.defaultRoleId;
      document.getElementById('quickRole').value = state.defaultRoleId;
    }

    loadSchedules();
    loadChannelStates();
    loadSectionStates();
  } else {
    state.connected = false;
    pill.classList.remove('connected');
    statusText.textContent = 'Déconnecté';
  }
}

// ─── RENDER HELPERS ─────────────────────────────────────────────────────────
function renderChannels(containerId, selectedIds = []) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const grouped = {};
  for (const ch of state.channels) {
    if (!grouped[ch.parentName]) grouped[ch.parentName] = [];
    grouped[ch.parentName].push(ch);
  }

  container.innerHTML = '';

  for (const [cat, channels] of Object.entries(grouped)) {
    const label = document.createElement('div');
    label.className = 'category-label';
    label.textContent = cat;
    container.appendChild(label);

    for (const ch of channels) {
      const isLocked = !!state.channelStates[ch.id];
      const isSelected = selectedIds.includes(ch.id);
      const item = document.createElement('div');
      item.className = `channel-item${isLocked ? ' channel-locked' : ''}${isSelected ? ' selected' : ''}`;
      item.dataset.id = ch.id;

      let badge = '';
      if (ch.isTicket) badge = '<span class="ticket-badge">🎫</span>';
      else if (isLocked) badge = '<span class="lock-icon">🔒</span>';

      item.innerHTML = `
        <span class="channel-hash">#</span>
        <span class="channel-name">${ch.name}</span>
        ${badge}
        <div class="channel-check"></div>
      `;
      item.addEventListener('click', () => item.classList.toggle('selected'));
      container.appendChild(item);
    }
  }
}

function renderRoles(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">— Choisir un rôle —</option>';
  for (const role of state.roles) {
    const opt = document.createElement('option');
    opt.value = role.id;
    opt.textContent = `@${role.name}`;
    select.appendChild(opt);
  }
  if (current) select.value = current;
}

function getSelectedChannels(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  return [...container.querySelectorAll('.channel-item.selected')].map(el => el.dataset.id);
}

// ─── CONNEXION ───────────────────────────────────────────────────────────────
async function connectBot() {
  const token = document.getElementById('botToken').value.trim();
  if (!token) return showError('connectError', 'Token requis');

  const btn = event.target.closest('button');
  btn.textContent = '⏳ Connexion...';
  btn.disabled = true;
  hideError('connectError');

  try {
    const res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();
    if (!res.ok) showError('connectError', data.error || 'Erreur de connexion');
    else { showToast('✅ Bot connecté avec succès !', 'success'); setTimeout(pollStatus, 1500); }
  } catch (e) {
    showError('connectError', 'Erreur réseau');
  } finally {
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M14 12H3"/></svg> Connecter`;
    btn.disabled = false;
  }
}

// ─── RÔLE PAR DÉFAUT ─────────────────────────────────────────────────────────
async function saveDefaultRole() {
  const roleId = document.getElementById('defaultRoleSelect').value;
  if (!roleId) return showError('defaultRoleSaved', 'Veuillez choisir un rôle');
  try {
    const res = await fetch('/api/default-role', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    state.defaultRoleId = roleId;
    document.getElementById('quickRole').value = roleId;
    const roleName = state.roles.find(r => r.id === roleId)?.name || roleId;
    const el = document.getElementById('defaultRoleSaved');
    el.textContent = `✅ Rôle par défaut enregistré : @${roleName}`;
    el.style.display = '';
    setTimeout(() => el.style.display = 'none', 3000);
    showToast(`✅ Rôle par défaut : @${roleName}`, 'success');
  } catch (e) { showToast(`Erreur: ${e.message}`, 'error'); }
}

// ─── LOCK / UNLOCK TOUT ──────────────────────────────────────────────────────
async function lockAll() {
  if (!state.defaultRoleId) return showToast('⚠ Définissez d\'abord un rôle par défaut', 'error');
  const message = document.getElementById('lockAllMessage').value.trim();
  const roleName = state.roles.find(r => r.id === state.defaultRoleId)?.name || state.defaultRoleId;
  if (!confirm(`Verrouiller TOUS les channels pour @${roleName} ?`)) return;
  showToast('⏳ Verrouillage en cours...', '');
  try {
    const res = await fetch('/api/lock-all', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(`🔒 ${data.results.filter(r => r.success).length} channels verrouillés`, 'success');
    await loadChannelStates();
    renderChannels('quickChannels'); renderChannels('schedChannels');
  } catch (e) { showToast(`Erreur: ${e.message}`, 'error'); }
}

async function unlockAll(restoreInitial) {
  if (!confirm(restoreInitial ? 'Restaurer l\'état initial de tous les channels ?' : 'Déverrouiller tous les channels ?')) return;
  showToast('⏳ Restauration en cours...', '');
  try {
    const res = await fetch('/api/unlock-all', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restoreInitial })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const ok = data.results.filter(r => r.success).length;
    showToast(restoreInitial ? `🏠 ${ok} channels restaurés` : `🔓 ${ok} channels déverrouillés`, 'success');
    await loadChannelStates();
    renderChannels('quickChannels'); renderChannels('schedChannels');
  } catch (e) { showToast(`Erreur: ${e.message}`, 'error'); }
}

// ─── ÉTAT DES CHANNELS ───────────────────────────────────────────────────────
async function loadChannelStates() {
  try {
    const res = await fetch('/api/channel-states');
    state.channelStates = await res.json();
    renderChannelStates();
  } catch (e) {}
}

function renderChannelStates() {
  const container = document.getElementById('channelStatesList');
  if (!container) return;
  const entries = Object.entries(state.channelStates);
  if (entries.length === 0) {
    container.innerHTML = '<div class="empty-state">Aucun channel modifié par le bot actuellement</div>';
    return;
  }
  container.innerHTML = '';
  for (const [channelId, info] of entries) {
    const roleName = state.roles.find(r => r.id === info.roleId)?.name || info.roleId;
    const lockedAgo = info.lockedAt ? timeAgo(new Date(info.lockedAt)) : '';
    const row = document.createElement('div');
    row.className = 'channel-state-row';
    row.innerHTML = `
      <div class="channel-state-info">
        <span class="channel-state-icon">🔒</span>
        <div>
          <div class="channel-state-name">#${info.channelName}</div>
          <div class="channel-state-meta">${info.parentName} · @${roleName} · ${lockedAgo}</div>
        </div>
      </div>
      <div class="channel-state-actions">
        <button class="btn btn-ghost btn-sm" onclick="unlockSingle('${channelId}', '${info.roleId}', false)">Unlock</button>
        <button class="btn btn-ghost btn-sm" onclick="unlockSingle('${channelId}', '${info.roleId}', true)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
          Restaurer
        </button>
      </div>`;
    container.appendChild(row);
  }
}

async function unlockSingle(channelId, roleId, restoreInitial) {
  try {
    const res = await fetch('/api/unlock-now', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelIds: [channelId], roleId, restoreInitial })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(restoreInitial ? '🏠 Channel restauré' : '🔓 Channel déverrouillé', 'success');
    await loadChannelStates();
    renderChannels('quickChannels'); renderChannels('schedChannels');
  } catch (e) { showToast(`Erreur: ${e.message}`, 'error'); }
}

// ─── LOCK / UNLOCK IMMÉDIAT ──────────────────────────────────────────────────
async function lockNow() {
  const channelIds = getSelectedChannels('quickChannels');
  const roleId = document.getElementById('quickRole').value;
  const message = document.getElementById('quickMessage').value.trim();
  if (!roleId) return showFeedback('Veuillez choisir un rôle', false);
  if (!channelIds.length) return showFeedback('Veuillez sélectionner au moins un channel', false);
  try {
    const res = await fetch('/api/lock-now', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelIds, roleId, message })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const ok = data.results.filter(r => r.success).length;
    showFeedback(`🔒 ${ok}/${channelIds.length} channels verrouillés`, true);
    showToast(`🔒 ${ok} channels verrouillés`, 'success');
    await loadChannelStates();
    renderChannels('quickChannels'); renderChannels('schedChannels');
  } catch (e) { showFeedback(`Erreur: ${e.message}`, false); }
}

async function unlockNow(restoreInitial) {
  const channelIds = getSelectedChannels('quickChannels');
  const roleId = document.getElementById('quickRole').value;
  if (!roleId) return showFeedback('Veuillez choisir un rôle', false);
  if (!channelIds.length) return showFeedback('Veuillez sélectionner au moins un channel', false);
  try {
    const res = await fetch('/api/unlock-now', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelIds, roleId, restoreInitial })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const ok = data.results.filter(r => r.success).length;
    const msg = restoreInitial ? `🏠 ${ok}/${channelIds.length} channels restaurés` : `🔓 ${ok}/${channelIds.length} channels déverrouillés`;
    showFeedback(msg, true); showToast(msg, 'success');
    await loadChannelStates();
    renderChannels('quickChannels'); renderChannels('schedChannels');
  } catch (e) { showFeedback(`Erreur: ${e.message}`, false); }
}

function showFeedback(msg, success) {
  const el = document.getElementById('actionFeedback');
  el.textContent = msg; el.style.display = '';
  el.style.color = success ? 'var(--success)' : 'var(--danger)';
  el.style.borderColor = success ? 'rgba(87,242,135,0.3)' : 'rgba(237,66,69,0.3)';
  el.style.background = success ? 'rgba(87,242,135,0.08)' : 'rgba(237,66,69,0.08)';
}

// ─── SECTIONS ────────────────────────────────────────────────────────────────
async function loadSectionStates() {
  try {
    const res = await fetch('/api/sections');
    state.sectionStates = await res.json();
    updateSectionToggles();
  } catch (e) {}
}

function updateSectionToggles() {
  for (const [sec, active] of Object.entries(state.sectionStates)) {
    const btn = document.getElementById(`sectionToggle_${sec}`);
    const pill = document.getElementById(`sectionPill_${sec}`);
    const body = document.getElementById(`sectionBody_${sec}`);
    if (btn) {
      btn.classList.toggle('section-toggle-on', active);
      btn.classList.toggle('section-toggle-off', !active);
      btn.querySelector('.toggle-label').textContent = active ? 'ON' : 'OFF';
    }
    if (pill) {
      pill.classList.toggle('section-pill-on', active);
      pill.classList.toggle('section-pill-off', !active);
      pill.textContent = active ? 'Actif' : 'En pause';
    }
    if (body) body.classList.toggle('section-paused', !active);
  }
}

async function toggleSection(section) {
  try {
    const res = await fetch(`/api/sections/${section}/toggle`, { method: 'PATCH' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    state.sectionStates[section] = data.active;
    updateSectionToggles();
    const label = section === 'vie_privee' ? 'Vie privée' : 'Cours';
    showToast(data.active ? `▶ ${label} activée` : `⏸ ${label} mise en pause`, data.active ? 'success' : '');
    loadSchedules();
  } catch (e) { showToast(`Erreur: ${e.message}`, 'error'); }
}

// ─── PLANIFICATIONS ──────────────────────────────────────────────────────────
async function addSchedule() {
  const day = document.getElementById('schedDay').value;
  const startTime = document.getElementById('schedStart').value;
  const endTime = document.getElementById('schedEnd').value;
  const roleId = document.getElementById('schedRole').value;
  const lockMessage = document.getElementById('schedMessage').value.trim();
  const channelIds = getSelectedChannels('schedChannels');
  const section = document.getElementById('schedSection').value;

  hideError('schedError');
  if (!roleId) return showError('schedError', 'Veuillez choisir un rôle');
  if (!channelIds.length) return showError('schedError', 'Sélectionnez au moins un channel');
  if (!startTime || !endTime) return showError('schedError', 'Heures invalides');
  if (startTime >= endTime) return showError('schedError', 'L\'heure de lock doit être avant l\'heure d\'unlock');

  try {
    const res = await fetch('/api/schedules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day, startTime, endTime, channelIds, roleId, lockMessage, section })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(`✅ Lock planifié : ${capitalize(day)} ${startTime}–${endTime}`, 'success');
    document.querySelectorAll('#schedChannels .channel-item').forEach(el => el.classList.remove('selected'));
    loadSchedules();
  } catch (e) { showError('schedError', e.message); }
}

async function loadSchedules() {
  try {
    const res = await fetch('/api/schedules');
    state.schedules = await res.json();
    renderSchedules();
  } catch (e) {}
}

function renderSchedules() {
  renderSection('vie_privee');
  renderSection('cours');
  updateSectionCounts();
}

function updateSectionCounts() {
  for (const sec of ['vie_privee', 'cours']) {
    const count = state.schedules.filter(s => s.section === sec).length;
    const el = document.getElementById(`sectionCount_${sec}`);
    if (el) el.textContent = `${count} planification${count !== 1 ? 's' : ''}`;
    // Griser le body si la section est OFF
    const body = document.getElementById(`sectionBody_${sec}`);
    if (body) {
      const active = state.sectionStates[sec] !== false;
      body.classList.toggle('section-paused', !active);
    }
  }
}

function renderSection(section) {
  const container = document.getElementById(`schedules_${section}`);
  if (!container) return;

  const sectionSchedules = state.schedules.filter(s => s.section === section);

  if (sectionSchedules.length === 0) {
    container.innerHTML = '<div class="empty-state">Aucune planification dans cette section</div>';
    return;
  }

  container.innerHTML = '';

  for (const s of sectionSchedules) {
    const channelNames = s.channelIds
      .map(id => state.channels.find(c => c.id === id)?.name || id)
      .slice(0, 4);
    const roleName = state.roles.find(r => r.id === s.roleId)?.name || s.roleId;
    const moreChannels = Math.max(0, s.channelIds.length - 4);
    const sectionActive = state.sectionStates[section] !== false;

    const card = document.createElement('div');
    card.className = `schedule-card${(s.active && sectionActive) ? '' : ' inactive'}`;
    card.innerHTML = `
      <div class="schedule-badge">
        <div class="day">${s.day.slice(0,3)}</div>
        <div class="time">${s.startTime}<br>${s.endTime}</div>
      </div>
      <div class="schedule-info">
        <h3>${capitalize(s.day)} · ${s.startTime} → ${s.endTime}</h3>
        <div class="schedule-tags">
          <span class="tag tag-role">@${roleName}</span>
          ${channelNames.map(n => `<span class="tag tag-channel">#${n}</span>`).join('')}
          ${moreChannels > 0 ? `<span class="tag tag-channel">+${moreChannels}</span>` : ''}
          ${s.lockMessage ? `<span class="tag tag-msg">${escapeHtml(s.lockMessage)}</span>` : '<span class="tag tag-msg" style="color:var(--text-faint)">Sans message</span>'}
        </div>
        ${s.lastLocked ? `<div style="font-size:11px;color:var(--text-faint);margin-top:8px;font-family:var(--font-mono)">Dernier lock: ${new Date(s.lastLocked).toLocaleString('fr-FR')}</div>` : ''}
      </div>
      <div class="schedule-actions">
        <button class="btn btn-ghost btn-sm" onclick="openEditModal('${s.id}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Modifier
        </button>
        <button class="toggle-btn${s.active ? ' active' : ''}" onclick="toggleSchedule('${s.id}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/>${s.active ? '<path d="M10 15l-3-3 3-3M14 9l3 3-3 3"/>' : '<path d="M5 3l14 9-14 9V3z"/>'}</svg>
          ${s.active ? 'Actif' : 'Inactif'}
        </button>
        <button class="delete-btn" onclick="deleteSchedule('${s.id}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          Supprimer
        </button>
      </div>`;
    container.appendChild(card);
  }
}

// ─── MODALE ÉDITION ──────────────────────────────────────────────────────────
function openEditModal(scheduleId) {
  const s = state.schedules.find(s => s.id === scheduleId);
  if (!s) return;

  let modal = document.getElementById('editModal');
  if (!modal) { modal = document.createElement('div'); modal.id = 'editModal'; modal.className = 'modal-overlay'; document.body.appendChild(modal); }

  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="panel-label">MODIFIER LA PLANIFICATION</div>
        <button class="modal-close" onclick="closeEditModal()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="grid-4" style="margin-bottom:16px">
        <div class="input-group" style="margin-bottom:0">
          <label>Jour</label>
          <select id="editDay">
            ${['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'].map(d =>
              `<option value="${d}"${s.day === d ? ' selected' : ''}>${capitalize(d)}</option>`).join('')}
          </select>
        </div>
        <div class="input-group" style="margin-bottom:0">
          <label>Heure de lock</label>
          <input type="time" id="editStart" value="${s.startTime}">
        </div>
        <div class="input-group" style="margin-bottom:0">
          <label>Heure d'unlock</label>
          <input type="time" id="editEnd" value="${s.endTime}">
        </div>
        <div class="input-group" style="margin-bottom:0">
          <label>Rôle ciblé</label>
          <select id="editRole">
            <option value="">— Choisir —</option>
            ${state.roles.map(r => `<option value="${r.id}"${r.id === s.roleId ? ' selected' : ''}>@${r.name}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="grid-2" style="margin-bottom:16px">
        <div class="input-group" style="margin-bottom:0">
          <label>Section</label>
          <select id="editSection">
            <option value="vie_privee"${s.section === 'vie_privee' ? ' selected' : ''}>🏠 Vie privée</option>
            <option value="cours"${s.section === 'cours' ? ' selected' : ''}>📚 Cours</option>
          </select>
        </div>
        <div class="input-group" style="margin-bottom:0">
          <label>Message de lock (optionnel)</label>
          <input type="text" id="editMessage" placeholder="🔒 Ce channel est verrouillé..." value="${escapeHtml(s.lockMessage || '')}">
        </div>
      </div>
      <div class="input-group">
        <label>Channels ciblés</label>
        <div class="channel-grid" id="editChannels" style="max-height:220px"></div>
      </div>
      <div id="editError" class="error-msg" style="display:none"></div>
      <div class="action-row" style="margin-top:8px">
        <button class="btn btn-primary" onclick="saveEditModal('${scheduleId}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          Enregistrer
        </button>
        <button class="btn btn-ghost" onclick="closeEditModal()">Annuler</button>
      </div>
    </div>`;

  renderChannels('editChannels', s.channelIds);
  modal.style.display = 'flex';
  modal.addEventListener('click', (e) => { if (e.target === modal) closeEditModal(); });
}

function closeEditModal() {
  const modal = document.getElementById('editModal');
  if (modal) modal.style.display = 'none';
}

async function saveEditModal(scheduleId) {
  const day = document.getElementById('editDay').value;
  const startTime = document.getElementById('editStart').value;
  const endTime = document.getElementById('editEnd').value;
  const roleId = document.getElementById('editRole').value;
  const lockMessage = document.getElementById('editMessage').value.trim();
  const channelIds = getSelectedChannels('editChannels');
  const section = document.getElementById('editSection').value;

  hideError('editError');
  if (!roleId) return showError('editError', 'Veuillez choisir un rôle');
  if (!channelIds.length) return showError('editError', 'Sélectionnez au moins un channel');
  if (!startTime || !endTime) return showError('editError', 'Heures invalides');
  if (startTime >= endTime) return showError('editError', 'L\'heure de lock doit être avant l\'heure d\'unlock');

  try {
    const res = await fetch(`/api/schedules/${scheduleId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day, startTime, endTime, channelIds, roleId, lockMessage, section })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('✅ Planification mise à jour', 'success');
    closeEditModal();
    loadSchedules();
  } catch (e) { showError('editError', e.message); }
}

async function toggleSchedule(id) {
  try {
    const res = await fetch(`/api/schedules/${id}/toggle`, { method: 'PATCH' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(data.schedule.active ? '▶ Planification activée' : '⏸ Planification désactivée', 'success');
    loadSchedules();
  } catch (e) { showToast(`Erreur: ${e.message}`, 'error'); }
}

async function deleteSchedule(id) {
  if (!confirm('Supprimer cette planification ?')) return;
  try {
    const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Erreur suppression');
    showToast('🗑 Planification supprimée', 'success');
    loadSchedules();
  } catch (e) { showToast(`Erreur: ${e.message}`, 'error'); }
}

// ─── UI HELPERS ──────────────────────────────────────────────────────────────
function showError(id, msg) { const el = document.getElementById(id); if (el) { el.textContent = msg; el.style.display = ''; } }
function hideError(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

let toastTimeout;
function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast${type ? ` toast-${type}` : ''}`;
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 3500);
}

function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }
function escapeHtml(str) { return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function timeAgo(date) {
  const diff = Math.floor((Date.now() - date) / 1000);
  if (diff < 60) return `il y a ${diff}s`;
  if (diff < 3600) return `il y a ${Math.floor(diff/60)}min`;
  if (diff < 86400) return `il y a ${Math.floor(diff/3600)}h`;
  return `il y a ${Math.floor(diff/86400)}j`;
}