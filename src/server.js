const express = require('express');
const cors = require('cors');
const path = require('path');
const {
  connectBot, lockChannels, unlockChannels,
  lockAllChannels, unlockAllChannels,
  getStatus, refreshGuildData,
  setDefaultRole, getDefaultRole, getChannelStates,
} = require('./bot');
const {
  createSchedule, updateSchedule, deleteSchedule,
  toggleSchedule, toggleSection, getSectionStates,
  getSchedules,
} = require('./scheduler');

const app = express();
app.use(cors());
app.use(express.json());

const BASE_PATH = process.env.BASE_PATH || '/lock';

app.use(`${BASE_PATH}`, express.static(path.join(__dirname, '../public')));

// ─── STATUS ───────────────────────────────────────────────────────────────────
app.get(`${BASE_PATH}/api/status`, async (req, res) => {
  try { await refreshGuildData(); } catch (e) {}
  res.json(getStatus());
});

// ─── CONNEXION BOT ────────────────────────────────────────────────────────────
app.post(`${BASE_PATH}/api/connect`, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token requis' });
  try {
    await connectBot(token);
    await new Promise(r => setTimeout(r, 3000));
    await refreshGuildData();
    res.json({ success: true, status: getStatus() });
  } catch (err) {
    res.status(500).json({ error: `Connexion échouée: ${err.message}` });
  }
});

// ─── RÔLE PAR DÉFAUT ─────────────────────────────────────────────────────────
app.get(`${BASE_PATH}/api/default-role`, (req, res) => res.json({ defaultRoleId: getDefaultRole() }));

app.post(`${BASE_PATH}/api/default-role`, (req, res) => {
  const { roleId } = req.body;
  if (!roleId) return res.status(400).json({ error: 'roleId requis' });
  setDefaultRole(roleId);
  res.json({ success: true, defaultRoleId: roleId });
});

// ─── ÉTATS DES CHANNELS ───────────────────────────────────────────────────────
app.get(`${BASE_PATH}/api/channel-states`, (req, res) => res.json(getChannelStates()));

// ─── LOCK / UNLOCK ────────────────────────────────────────────────────────────
app.post(`${BASE_PATH}/api/lock-now`, async (req, res) => {
  const { channelIds, roleId, message } = req.body;
  if (!channelIds?.length || !roleId) return res.status(400).json({ error: 'channelIds et roleId requis' });
  try { res.json({ success: true, results: await lockChannels(channelIds, roleId, message) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post(`${BASE_PATH}/api/unlock-now`, async (req, res) => {
  const { channelIds, roleId, restoreInitial } = req.body;
  if (!channelIds?.length || !roleId) return res.status(400).json({ error: 'channelIds et roleId requis' });
  try { res.json({ success: true, results: await unlockChannels(channelIds, roleId, restoreInitial || false) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post(`${BASE_PATH}/api/lock-all`, async (req, res) => {
  try { res.json({ success: true, results: await lockAllChannels(req.body.message) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post(`${BASE_PATH}/api/unlock-all`, async (req, res) => {
  try { res.json({ success: true, results: await unlockAllChannels(req.body.restoreInitial || false) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PLANIFICATIONS ───────────────────────────────────────────────────────────
app.get(`${BASE_PATH}/api/schedules`, (req, res) => res.json(getSchedules()));

app.post(`${BASE_PATH}/api/schedules`, (req, res) => {
  try { res.json({ success: true, schedule: createSchedule(req.body) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

app.put(`${BASE_PATH}/api/schedules/:id`, (req, res) => {
  try { res.json({ success: true, schedule: updateSchedule(req.params.id, req.body) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete(`${BASE_PATH}/api/schedules/:id`, (req, res) => {
  try { deleteSchedule(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(404).json({ error: err.message }); }
});

app.patch(`${BASE_PATH}/api/schedules/:id/toggle`, (req, res) => {
  try { res.json({ success: true, schedule: toggleSchedule(req.params.id) }); }
  catch (err) { res.status(404).json({ error: err.message }); }
});

// ─── SECTIONS ─────────────────────────────────────────────────────────────────
app.get(`${BASE_PATH}/api/sections`, (req, res) => res.json(getSectionStates()));

app.patch(`${BASE_PATH}/api/sections/:section/toggle`, (req, res) => {
  try { res.json({ success: true, ...toggleSection(req.params.section) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// ─── CATCH-ALL ────────────────────────────────────────────────────────────────
app.get(`${BASE_PATH}`, (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get(`${BASE_PATH}/*path`, (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Dashboard disponible sur http://localhost:${PORT}${BASE_PATH || '/'}`));

module.exports = app;