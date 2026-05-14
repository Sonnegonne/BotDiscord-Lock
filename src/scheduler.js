const cron = require('node-cron');
const { lockChannels, unlockChannels } = require('./bot');

let schedules = [];
let cronJobs = {};

// État ON/OFF par section — suspendre une section stoppe tous ses jobs
// sans modifier le flag `active` de chaque planification individuelle
const sectionStates = {
  vie_privee: true,
  cours: true,
};

const DAYS_MAP = {
  'lundi': 1, 'mardi': 2, 'mercredi': 3, 'jeudi': 4,
  'vendredi': 5, 'samedi': 6, 'dimanche': 0
};

const VALID_SECTIONS = ['vie_privee', 'cours'];

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function timeToCron(hour, minute, dayOfWeek) {
  return `${minute} ${hour} * * ${dayOfWeek}`;
}

function parseTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return { hour: h, minute: m || 0 };
}

// Un job est actif uniquement si la planif ET sa section sont toutes deux ON
function isEffectivelyActive(schedule) {
  return schedule.active && sectionStates[schedule.section] !== false;
}

function createSchedule(data) {
  const id = generateId();
  const { day, startTime, endTime, channelIds, roleId, lockMessage, section } = data;

  const dayNum = DAYS_MAP[day.toLowerCase()];
  if (dayNum === undefined) throw new Error('Jour invalide');

  const sec = section && VALID_SECTIONS.includes(section) ? section : 'vie_privee';

  const schedule = {
    id, day, dayNum, startTime, endTime, channelIds, roleId,
    section: sec,
    lockMessage: (lockMessage && lockMessage.trim()) ? lockMessage.trim() : null,
    active: true,
    createdAt: new Date().toISOString(),
    lastLocked: null,
    lastUnlocked: null,
  };

  schedules.push(schedule);
  registerCronJobs(schedule);
  return schedule;
}

function updateSchedule(id, data) {
  const idx = schedules.findIndex(s => s.id === id);
  if (idx === -1) throw new Error('Planification introuvable');

  const { day, startTime, endTime, channelIds, roleId, lockMessage, active, section } = data;
  const dayNum = day !== undefined ? DAYS_MAP[day.toLowerCase()] : schedules[idx].dayNum;
  if (day !== undefined && dayNum === undefined) throw new Error('Jour invalide');

  const updated = {
    ...schedules[idx],
    ...(day !== undefined && { day, dayNum }),
    ...(startTime !== undefined && { startTime }),
    ...(endTime !== undefined && { endTime }),
    ...(channelIds !== undefined && { channelIds }),
    ...(roleId !== undefined && { roleId }),
    ...(lockMessage !== undefined && { lockMessage: lockMessage.trim() || null }),
    ...(active !== undefined && { active }),
    ...(section !== undefined && VALID_SECTIONS.includes(section) && { section }),
    updatedAt: new Date().toISOString(),
  };

  if (updated.startTime >= updated.endTime) {
    throw new Error("L'heure de lock doit être avant l'heure d'unlock");
  }

  schedules[idx] = updated;
  registerCronJobs(updated);
  return updated;
}

function registerCronJobs(schedule) {
  if (cronJobs[schedule.id]) {
    try { cronJobs[schedule.id].lockJob.stop(); } catch (e) {}
    try { cronJobs[schedule.id].unlockJob.stop(); } catch (e) {}
    delete cronJobs[schedule.id];
  }

  if (!isEffectivelyActive(schedule)) return;

  const startCron = timeToCron(parseTime(schedule.startTime).hour, parseTime(schedule.startTime).minute, schedule.dayNum);
  const endCron = timeToCron(parseTime(schedule.endTime).hour, parseTime(schedule.endTime).minute, schedule.dayNum);

  const lockJob = cron.schedule(startCron, async () => {
    try {
      await lockChannels(schedule.channelIds, schedule.roleId, schedule.lockMessage || '');
      const s = schedules.find(s => s.id === schedule.id);
      if (s) s.lastLocked = new Date().toISOString();
    } catch (err) {
      console.error(`[CRON] Erreur lock: ${err.message}`);
    }
  }, { timezone: 'Europe/Paris' });

  const unlockJob = cron.schedule(endCron, async () => {
    try {
      await unlockChannels(schedule.channelIds, schedule.roleId);
      const s = schedules.find(s => s.id === schedule.id);
      if (s) s.lastUnlocked = new Date().toISOString();
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

// Active/désactive toute une section et recrée les jobs en conséquence
function toggleSection(section) {
  if (!VALID_SECTIONS.includes(section)) throw new Error('Section invalide');
  sectionStates[section] = !sectionStates[section];
  schedules.filter(s => s.section === section).forEach(s => registerCronJobs(s));
  return { section, active: sectionStates[section] };
}

function getSectionStates() {
  return { ...sectionStates };
}

function getSchedules() { return schedules; }

module.exports = {
  createSchedule, updateSchedule, deleteSchedule,
  toggleSchedule, toggleSection, getSectionStates,
  getSchedules,
};