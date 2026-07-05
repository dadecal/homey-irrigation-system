(function exposeSettingsCalculations(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.IrrigationSettingsCalculations = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

  function calculateEndTime(startTime, sectorDurations = {}) {
    const match = TIME_PATTERN.exec(String(startTime || ''));
    if (!match) return null;

    const durationMinutes = Object.values(sectorDurations).reduce((total, value) => {
      const minutes = Number(value);
      return total + (Number.isFinite(minutes) && minutes > 0 ? minutes : 0);
    }, 0);
    const totalMinutes = Number(match[1]) * 60 + Number(match[2]) + durationMinutes;
    const daysLater = Math.floor(totalMinutes / 1440);
    const minuteOfDay = totalMinutes % 1440;
    const hours = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
    const minutes = String(minuteOfDay % 60).padStart(2, '0');

    return { time: `${hours}:${minutes}`, daysLater, durationMinutes };
  }

  function snapshotConfig(config) {
    const sectorDurations = {};
    for (let sector = 1; sector <= 6; sector += 1) {
      sectorDurations[String(sector)] = Number(config?.sectorDurations?.[String(sector)] || 0);
    }

    return JSON.stringify({
      enabled: Boolean(config?.enabled),
      notifySectorStart: Boolean(config?.notifySectorStart),
      notifySectorEnd: Boolean(config?.notifySectorEnd),
      startTime: String(config?.startTime || ''),
      intervalDays: Number(config?.intervalDays),
      sectorDurations,
    });
  }

  return { calculateEndTime, snapshotConfig };
}));
