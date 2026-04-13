const cron = require('node-cron');
const { lockChannels, unlockChannels } = require('./bot');

// Stockage en mémoire des planifications
let schedules = [];
let cronJobs = {}; // id -> { lockJob, unlockJob }

const DAYS_MAP = {
  'lundi': 1, 'mardi': 2, 'mercredi': 3, 'jeudi': 4,
  'vendredi': 5, 'samedi': 6, 'dimanche': 0
};

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function timeToCron(hour, minute, dayOfWeek) {
  // cron: minute heure * * jourSemaine
  return `${minute} ${hour} * * ${dayOfWeek}`;
}

function parseTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return { hour: h, minute: m || 0 };
}

function addMinutes(hour, minute, mins) {
  let m = minute + mins;
  let h = hour + Math.floor(m / 60);
  m = m % 60;
  return { hour: h % 24, minute: m };
}

function createSchedule(data) {
  const id = generateId();
  const { day, startTime, endTime, channelIds, roleId, lockMessage } = data;

  const dayNum = DAYS_MAP[day.toLowerCase()];
  if (dayNum === undefined) throw new Error('Jour invalide');

  const start = parseTime(startTime);
  const end = parseTime(endTime);

  const schedule = {
    id,
    day,
    dayNum,
    startTime,
    endTime,
    channelIds,
    roleId,
    lockMessage: lockMessage || '🔒 Ce channel est temporairement verrouillé.',
    active: true,
    createdAt: new Date().toISOString(),
    lastLocked: null,
    lastUnlocked: null,
  };

  schedules.push(schedule);
  registerCronJobs(schedule);

  return schedule;
}

function registerCronJobs(schedule) {
  // Supprime les anciens jobs si existants
  if (cronJobs[schedule.id]) {
    try { cronJobs[schedule.id].lockJob.stop(); } catch (e) {}
    try { cronJobs[schedule.id].unlockJob.stop(); } catch (e) {}
  }

  if (!schedule.active) return;

  const startCron = timeToCron(
    parseTime(schedule.startTime).hour,
    parseTime(schedule.startTime).minute,
    schedule.dayNum
  );

  const endCron = timeToCron(
    parseTime(schedule.endTime).hour,
    parseTime(schedule.endTime).minute,
    schedule.dayNum
  );

  const lockJob = cron.schedule(startCron, async () => {
    console.log(`[CRON] Lock planifié déclenché: ${schedule.id}`);
    try {
      await lockChannels(schedule.channelIds, schedule.roleId, schedule.lockMessage);
      const s = schedules.find(s => s.id === schedule.id);
      if (s) s.lastLocked = new Date().toISOString();
      console.log(`[CRON] Channels verrouillés pour schedule ${schedule.id}`);
    } catch (err) {
      console.error(`[CRON] Erreur lock: ${err.message}`);
    }
  }, { timezone: 'Europe/Paris' });

  const unlockJob = cron.schedule(endCron, async () => {
    console.log(`[CRON] Unlock planifié déclenché: ${schedule.id}`);
    try {
      await unlockChannels(schedule.channelIds, schedule.roleId);
      const s = schedules.find(s => s.id === schedule.id);
      if (s) s.lastUnlocked = new Date().toISOString();
      console.log(`[CRON] Channels déverrouillés pour schedule ${schedule.id}`);
    } catch (err) {
      console.error(`[CRON] Erreur unlock: ${err.message}`);
    }
  }, { timezone: 'Europe/Paris' });

  cronJobs[schedule.id] = { lockJob, unlockJob };
}

function deleteSchedule(id) {
  const idx = schedules.findIndex(s => s.id === id);
  if (idx === -1) throw new Error('Planification introuvable');

  if (cronJobs[id]) {
    try { cronJobs[id].lockJob.stop(); } catch (e) {}
    try { cronJobs[id].unlockJob.stop(); } catch (e) {}
    delete cronJobs[id];
  }

  schedules.splice(idx, 1);
  return true;
}

function toggleSchedule(id) {
  const schedule = schedules.find(s => s.id === id);
  if (!schedule) throw new Error('Planification introuvable');

  schedule.active = !schedule.active;
  registerCronJobs(schedule);
  return schedule;
}

function getSchedules() {
  return schedules;
}

module.exports = { createSchedule, deleteSchedule, toggleSchedule, getSchedules };
