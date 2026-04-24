const express = require('express');
const cors = require('cors');
const path = require('path');
const {
  connectBot,
  lockChannels,
  unlockChannels,
  revertSnapshot,
  getPermissionHistory,
  getStatus,
  refreshGuildData,
} = require('./bot');
const { createSchedule, deleteSchedule, toggleSchedule, getSchedules } = require('./scheduler');

const app = express();
app.use(cors());
app.use(express.json());

// ─── BASE PATH ────────────────────────────────────────────────────────────────
const BASE_PATH = process.env.BASE_PATH || '/lock';

app.use(`${BASE_PATH}`, express.static(path.join(__dirname, '../public')));

// ─── STATUS ───────────────────────────────────────────────────────────────────
app.get(`${BASE_PATH}/api/status`, async (req, res) => {
  try {
    await refreshGuildData();
    res.json(getStatus());
  } catch (err) {
    res.json(getStatus());
  }
});

// ─── CONNEXION BOT ────────────────────────────────────────────────────────────
app.post(`${BASE_PATH}/api/connect`, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token requis' });

  try {
    await connectBot(token);
    await new Promise(resolve => setTimeout(resolve, 3000));
    await refreshGuildData();
    res.json({ success: true, status: getStatus() });
  } catch (err) {
    res.status(500).json({ error: `Connexion échouée: ${err.message}` });
  }
});

// ─── LOCK IMMÉDIAT ────────────────────────────────────────────────────────────
app.post(`${BASE_PATH}/api/lock-now`, async (req, res) => {
  const { channelIds, roleId, message } = req.body;
  if (!channelIds?.length || !roleId) {
    return res.status(400).json({ error: 'channelIds et roleId requis' });
  }

  try {
    const { results, snapshotId } = await lockChannels(channelIds, roleId, message);
    res.json({ success: true, results, snapshotId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── UNLOCK IMMÉDIAT ─────────────────────────────────────────────────────────
app.post(`${BASE_PATH}/api/unlock-now`, async (req, res) => {
  const { channelIds, roleId } = req.body;
  if (!channelIds?.length || !roleId) {
    return res.status(400).json({ error: 'channelIds et roleId requis' });
  }

  try {
    const { results } = await unlockChannels(channelIds, roleId);
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── HISTORIQUE DES MODIFICATIONS ────────────────────────────────────────────
app.get(`${BASE_PATH}/api/history`, (req, res) => {
  res.json(getPermissionHistory());
});

// ─── ANNULER UN SNAPSHOT (revert) ─────────────────────────────────────────────
app.post(`${BASE_PATH}/api/revert/:snapshotId`, async (req, res) => {
  try {
    const { results } = await revertSnapshot(req.params.snapshotId);
    res.json({ success: true, results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── PLANIFICATIONS ───────────────────────────────────────────────────────────
app.get(`${BASE_PATH}/api/schedules`, (req, res) => {
  res.json(getSchedules());
});

app.post(`${BASE_PATH}/api/schedules`, (req, res) => {
  try {
    const schedule = createSchedule(req.body);
    res.json({ success: true, schedule });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete(`${BASE_PATH}/api/schedules/:id`, (req, res) => {
  try {
    deleteSchedule(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.patch(`${BASE_PATH}/api/schedules/:id/toggle`, (req, res) => {
  try {
    const schedule = toggleSchedule(req.params.id);
    res.json({ success: true, schedule });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ─── SERVE DASHBOARD ─────────────────────────────────────────────────────────
app.get(`${BASE_PATH}`, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get(`${BASE_PATH}/*path`, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const base = BASE_PATH || '/';
  console.log(`🌐 Dashboard disponible sur http://localhost:${PORT}${base}`);
});

module.exports = app;