// ─── BASE PATH ────────────────────────────────────────────────────────────────
const BASE_PATH = document.querySelector('meta[name="base-path"]')?.content || '';

// ─── STATE ────────────────────────────────────────────────────────────────────
let state = {
  connected: false,
  guild: null,
  channels: [],
  roles: [],
  schedules: [],
  lockedChannels: [],  // IDs des channels verrouillés par le bot
  history: [],         // Historique des snapshots
};

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  pollStatus();
  setInterval(pollStatus, 8000);
});

async function pollStatus() {
  try {
    const res = await fetch(`${BASE_PATH}/api/status`);
    const data = await res.json();
    updateStatus(data);
  } catch (e) {}
}

function updateStatus(data) {
  const pill = document.getElementById('statusPill');
  const statusText = document.getElementById('statusText');

  if (data.connected && data.guild) {
    const wasConnected = state.connected;
    state.connected = true;
    state.guild = data.guild;
    state.channels = data.channels || [];
    state.roles = data.roles || [];
    state.lockedChannels = data.lockedChannels || [];

    pill.classList.add('connected');
    statusText.textContent = data.guild.name;

    document.getElementById('serverPanel').style.display = '';
    document.getElementById('immediatePanel').style.display = '';
    document.getElementById('schedulePanel').style.display = '';
    document.getElementById('schedulesListPanel').style.display = '';
    document.getElementById('historyPanel').style.display = '';

    document.getElementById('serverName').textContent = data.guild.name;
    document.getElementById('channelCount').textContent = `${data.channels.length} channels`;
    document.getElementById('roleCount').textContent = `${data.roles.length} rôles`;

    const avatar = document.getElementById('serverAvatar');
    if (data.guild.icon) {
      avatar.style.backgroundImage = `url(${data.guild.icon})`;
    }

    renderChannels('quickChannels');
    renderChannels('schedChannels');
    renderRoles('quickRole');
    renderRoles('schedRole');
    loadSchedules();
    loadHistory();

  } else {
    state.connected = false;
    pill.classList.remove('connected');
    statusText.textContent = 'Déconnecté';
  }
}

// ─── RENDER CHANNELS ─────────────────────────────────────────────────────────
function renderChannels(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Sauvegarde la sélection actuelle
  const selectedIds = new Set(
    [...container.querySelectorAll('.channel-item.selected')].map(el => el.dataset.id)
  );

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
      const isLocked = state.lockedChannels.includes(ch.id);
      const item = document.createElement('div');
      item.className = 'channel-item' +
        (selectedIds.has(ch.id) ? ' selected' : '') +
        (isLocked ? ' locked-by-bot' : '');
      item.dataset.id = ch.id;
      item.innerHTML = `
        <span class="channel-hash">#</span>
        <span class="channel-name">${escapeHtml(ch.name)}</span>
        ${isLocked ? '<span class="lock-indicator" title="Verrouillé par le bot">🔒</span>' : '<div class="channel-check"></div>'}
      `;
      item.addEventListener('click', () => {
        item.classList.toggle('selected');
      });
      container.appendChild(item);
    }
  }
}

// ─── RENDER ROLES ─────────────────────────────────────────────────────────────
function renderRoles(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;

  // Récupère le rôle actuellement sélectionné ou le dernier rôle mémorisé
  const savedKey = `lastRole_${selectId}`;
  const previousValue = select.value || localStorage.getItem(savedKey) || '';

  select.innerHTML = '<option value="">— Choisir un rôle —</option>';
  for (const role of state.roles) {
    const opt = document.createElement('option');
    opt.value = role.id;
    opt.textContent = `@${role.name}`;
    select.appendChild(opt);
  }

  // Restaure la sélection précédente si elle existe toujours
  if (previousValue) {
    select.value = previousValue;
    if (!select.value && previousValue) {
      // Le rôle n'existe plus, on vide la mémoire
      localStorage.removeItem(savedKey);
    }
  }

  // Mémorise le rôle à chaque changement
  select.addEventListener('change', () => {
    if (select.value) localStorage.setItem(savedKey, select.value);
  });
}

function getSelectedChannels(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  return [...container.querySelectorAll('.channel-item.selected')].map(el => el.dataset.id);
}

// ─── CONNEXION ────────────────────────────────────────────────────────────────
async function connectBot() {
  const token = document.getElementById('botToken').value.trim();
  if (!token) return showError('connectError', 'Token requis');

  const btn = event.target.closest('button');
  btn.textContent = '⏳ Connexion...';
  btn.disabled = true;

  hideError('connectError');

  try {
    const res = await fetch(`${BASE_PATH}/api/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();

    if (!res.ok) {
      showError('connectError', data.error || 'Erreur de connexion');
    } else {
      showToast('✅ Bot connecté avec succès !', 'success');
      setTimeout(pollStatus, 1500);
    }
  } catch (e) {
    showError('connectError', 'Erreur réseau');
  } finally {
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M14 12H3"/></svg> Connecter`;
    btn.disabled = false;
  }
}

// ─── LOCK / UNLOCK IMMÉDIAT ───────────────────────────────────────────────────
async function lockNow() {
  const channelIds = getSelectedChannels('quickChannels');
  const roleId = document.getElementById('quickRole').value;
  const message = document.getElementById('quickMessage').value.trim();

  if (!roleId) return showFeedback('Veuillez choisir un rôle', false);
  if (!channelIds.length) return showFeedback('Veuillez sélectionner au moins un channel', false);

  try {
    const res = await fetch(`${BASE_PATH}/api/lock-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelIds, roleId, message })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const ok = data.results.filter(r => r.success).length;
    showFeedback(`🔒 ${ok}/${channelIds.length} channels verrouillés`, true);
    showToast(`🔒 ${ok} channels verrouillés`, 'success');

    // Met à jour l'état des channels verrouillés
    await pollStatus();
    await loadHistory();
  } catch (e) {
    showFeedback(`Erreur: ${e.message}`, false);
  }
}

async function unlockNow() {
  const channelIds = getSelectedChannels('quickChannels');
  const roleId = document.getElementById('quickRole').value;

  if (!roleId) return showFeedback('Veuillez choisir un rôle', false);
  if (!channelIds.length) return showFeedback('Veuillez sélectionner au moins un channel', false);

  try {
    const res = await fetch(`${BASE_PATH}/api/unlock-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelIds, roleId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const ok = data.results.filter(r => r.success).length;
    showFeedback(`🔓 ${ok}/${channelIds.length} channels déverrouillés`, true);
    showToast(`🔓 ${ok} channels déverrouillés`, 'success');

    await pollStatus();
    await loadHistory();
  } catch (e) {
    showFeedback(`Erreur: ${e.message}`, false);
  }
}

function showFeedback(msg, success) {
  const el = document.getElementById('actionFeedback');
  el.textContent = msg;
  el.style.display = '';
  el.style.color = success ? 'var(--success)' : 'var(--danger)';
  el.style.borderColor = success ? 'rgba(87,242,135,0.3)' : 'rgba(237,66,69,0.3)';
  el.style.background = success ? 'rgba(87,242,135,0.08)' : 'rgba(237,66,69,0.08)';
}

// ─── HISTORIQUE & REVERT ──────────────────────────────────────────────────────
async function loadHistory() {
  try {
    const res = await fetch(`${BASE_PATH}/api/history`);
    const data = await res.json();
    state.history = data;
    renderHistory(data);
  } catch (e) {}
}

function renderHistory(history) {
  const container = document.getElementById('historyList');
  if (!container) return;

  if (history.length === 0) {
    container.innerHTML = '<div class="empty-state">Aucune modification enregistrée</div>';
    return;
  }

  container.innerHTML = '';

  // Affiche du plus récent au plus ancien
  const sorted = [...history].reverse();

  for (const entry of sorted) {
    const channelNames = entry.snapshots
      .map(s => state.channels.find(c => c.id === s.channelId)?.name || s.channelId)
      .slice(0, 4);
    const moreChannels = Math.max(0, entry.snapshots.length - 4);
    const roleName = state.roles.find(r => r.id === entry.roleId)?.name || entry.roleId;

    const card = document.createElement('div');
    card.className = 'history-card';
    card.innerHTML = `
      <div class="history-icon">🔒</div>
      <div class="history-info">
        <div class="history-title">
          <span class="tag tag-role">@${escapeHtml(roleName)}</span>
          <span class="history-time">${new Date(entry.lockedAt).toLocaleString('fr-FR')}</span>
        </div>
        <div class="schedule-tags" style="margin-top:6px;">
          ${channelNames.map(n => `<span class="tag tag-channel">#${escapeHtml(n)}</span>`).join('')}
          ${moreChannels > 0 ? `<span class="tag tag-channel">+${moreChannels}</span>` : ''}
          ${entry.message ? `<span class="tag tag-msg">${escapeHtml(entry.message)}</span>` : ''}
        </div>
        <div class="history-before">
          ${entry.snapshots.map(s => {
            const chName = state.channels.find(c => c.id === s.channelId)?.name || s.channelId;
            const beforeLabel = s.before === null ? 'héritage' : s.before ? 'autorisé' : 'refusé';
            const beforeClass = s.before === null ? 'before-inherit' : s.before ? 'before-allow' : 'before-deny';
            return `<span class="before-tag ${beforeClass}" title="État avant lock">#${escapeHtml(chName)}: ${beforeLabel}</span>`;
          }).join('')}
        </div>
      </div>
      <div class="history-actions">
        <button class="btn btn-ghost btn-sm revert-btn" onclick="revertSnapshot('${entry.snapshotId}', this)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
          Annuler
        </button>
      </div>
    `;
    container.appendChild(card);
  }
}

async function revertSnapshot(snapshotId, btn) {
  if (!confirm('Restaurer les permissions à leur état avant ce lock ?')) return;

  if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }

  try {
    const res = await fetch(`${BASE_PATH}/api/revert/${snapshotId}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const ok = data.results.filter(r => r.success).length;
    showToast(`↩️ ${ok} channel(s) restaurés`, 'success');

    await pollStatus();
    await loadHistory();
  } catch (e) {
    showToast(`Erreur: ${e.message}`, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Annuler'; }
  }
}

// ─── PLANIFICATIONS ───────────────────────────────────────────────────────────
async function addSchedule() {
  const day = document.getElementById('schedDay').value;
  const startTime = document.getElementById('schedStart').value;
  const endTime = document.getElementById('schedEnd').value;
  const roleId = document.getElementById('schedRole').value;
  const lockMessage = document.getElementById('schedMessage').value.trim();
  const channelIds = getSelectedChannels('schedChannels');

  hideError('schedError');

  if (!roleId) return showError('schedError', 'Veuillez choisir un rôle');
  if (!channelIds.length) return showError('schedError', 'Sélectionnez au moins un channel');
  if (!startTime || !endTime) return showError('schedError', 'Heures invalides');
  if (startTime >= endTime) return showError('schedError', "L'heure de lock doit être avant l'heure d'unlock");

  try {
    const res = await fetch(`${BASE_PATH}/api/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day, startTime, endTime, channelIds, roleId, lockMessage })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`✅ Lock planifié : ${capitalize(day)} ${startTime}–${endTime}`, 'success');
    document.querySelectorAll('#schedChannels .channel-item').forEach(el => el.classList.remove('selected'));
    loadSchedules();
  } catch (e) {
    showError('schedError', e.message);
  }
}

async function loadSchedules() {
  try {
    const res = await fetch(`${BASE_PATH}/api/schedules`);
    const data = await res.json();
    state.schedules = data;
    renderSchedules(data);
  } catch (e) {}
}

function renderSchedules(schedules) {
  const container = document.getElementById('schedulesList');
  if (!container) return;

  if (schedules.length === 0) {
    container.innerHTML = '<div class="empty-state">Aucune planification configurée</div>';
    return;
  }

  container.innerHTML = '';

  for (const s of schedules) {
    const channelNames = s.channelIds
      .map(id => state.channels.find(c => c.id === id)?.name || id)
      .slice(0, 4);
    const roleName = state.roles.find(r => r.id === s.roleId)?.name || s.roleId;
    const moreChannels = Math.max(0, s.channelIds.length - 4);

    const card = document.createElement('div');
    card.className = `schedule-card${s.active ? '' : ' inactive'}`;
    card.innerHTML = `
      <div class="schedule-badge">
        <div class="day">${s.day.slice(0,3)}</div>
        <div class="time">${s.startTime}<br>${s.endTime}</div>
      </div>
      <div class="schedule-info">
        <h3>${capitalize(s.day)} · ${s.startTime} → ${s.endTime}</h3>
        <div class="schedule-tags">
          <span class="tag tag-role">@${escapeHtml(roleName)}</span>
          ${channelNames.map(n => `<span class="tag tag-channel">#${escapeHtml(n)}</span>`).join('')}
          ${moreChannels > 0 ? `<span class="tag tag-channel">+${moreChannels}</span>` : ''}
          <span class="tag tag-msg">${escapeHtml(s.lockMessage)}</span>
        </div>
        ${s.lastLocked ? `<div style="font-size:11px;color:var(--text-faint);margin-top:8px;font-family:var(--font-mono)">Dernier lock: ${new Date(s.lastLocked).toLocaleString('fr-FR')}</div>` : ''}
      </div>
      <div class="schedule-actions">
        <button class="toggle-btn${s.active ? ' active' : ''}" onclick="toggleSchedule('${s.id}', this)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/>${s.active ? '<path d="M10 15l-3-3 3-3M14 9l3 3-3 3"/>' : '<path d="M5 3l14 9-14 9V3z"/>'}</svg>
          ${s.active ? 'Actif' : 'Inactif'}
        </button>
        <button class="delete-btn" onclick="deleteSchedule('${s.id}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          Supprimer
        </button>
      </div>
    `;
    container.appendChild(card);
  }
}

async function toggleSchedule(id, btn) {
  try {
    const res = await fetch(`${BASE_PATH}/api/schedules/${id}/toggle`, { method: 'PATCH' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(data.schedule.active ? '▶ Planification activée' : '⏸ Planification désactivée', 'success');
    loadSchedules();
  } catch (e) {
    showToast(`Erreur: ${e.message}`, 'error');
  }
}

async function deleteSchedule(id) {
  if (!confirm('Supprimer cette planification ?')) return;

  try {
    const res = await fetch(`${BASE_PATH}/api/schedules/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Erreur suppression');
    showToast('🗑 Planification supprimée', 'success');
    loadSchedules();
  } catch (e) {
    showToast(`Erreur: ${e.message}`, 'error');
  }
}

// ─── UI HELPERS ───────────────────────────────────────────────────────────────
function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = ''; }
}

function hideError(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

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

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}