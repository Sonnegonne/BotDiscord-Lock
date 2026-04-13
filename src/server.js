const express = require('express');
const cors = require('cors');
const path = require('path');
const { connectBot, lockChannels, unlockChannels, getStatus, refreshGuildData } = require('./bot');
const { createSchedule, deleteSchedule, toggleSchedule, getSchedules } = require('./scheduler');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ─── STATUS ───────────────────────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  try {
    const status = await refreshGuildData();
    res.json(getStatus());
  } catch (err) {
    res.json(getStatus());
  }
});

// ─── CONNEXION BOT ────────────────────────────────────────────────────────────
app.post('/api/connect', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token requis' });

  try {
    const status = await connectBot(token);
    // Attendre que le bot soit prêt
    await new Promise(resolve => setTimeout(resolve, 3000));
    await refreshGuildData();
    res.json({ success: true, status: getStatus() });
  } catch (err) {
    res.status(500).json({ error: `Connexion échouée: ${err.message}` });
  }
});

// ─── LOCK IMMÉDIAT ────────────────────────────────────────────────────────────
app.post('/api/lock-now', async (req, res) => {
  const { channelIds, roleId, message } = req.body;
  if (!channelIds?.length || !roleId) {
    return res.status(400).json({ error: 'channelIds et roleId requis' });
  }

  try {
    const results = await lockChannels(channelIds, roleId, message);
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── UNLOCK IMMÉDIAT ─────────────────────────────────────────────────────────
app.post('/api/unlock-now', async (req, res) => {
  const { channelIds, roleId } = req.body;
  if (!channelIds?.length || !roleId) {
    return res.status(400).json({ error: 'channelIds et roleId requis' });
  }

  try {
    const results = await unlockChannels(channelIds, roleId);
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PLANIFICATIONS ───────────────────────────────────────────────────────────
app.get('/api/schedules', (req, res) => {
  res.json(getSchedules());
});

app.post('/api/schedules', (req, res) => {
  try {
    const schedule = createSchedule(req.body);
    res.json({ success: true, schedule });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/schedules/:id', (req, res) => {
  try {
    deleteSchedule(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.patch('/api/schedules/:id/toggle', (req, res) => {
  try {
    const schedule = toggleSchedule(req.params.id);
    res.json({ success: true, schedule });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ─── SERVE DASHBOARD ─────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Dashboard disponible sur http://localhost:${PORT}`);
});

module.exports = app;
