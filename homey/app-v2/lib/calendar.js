'use strict';

function getZonedParts(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));

  return Object.fromEntries(
    parts
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]),
  );
}

function formatDateKey({ year, month, day }) {
  return [year, month, day]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0'))
    .join('-');
}

function getDateKey(timestamp, timeZone) {
  return formatDateKey(getZonedParts(timestamp, timeZone));
}

function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return formatDateKey({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

function toTimestamp(dateKey, time, timeZone) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let timestamp = desired;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = getZonedParts(timestamp, timeZone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const correction = desired - represented;
    timestamp += correction;
    if (correction === 0) break;
  }

  return timestamp;
}

module.exports = {
  addDays,
  getDateKey,
  toTimestamp,
};
