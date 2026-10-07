const DAY = 86400000;
const TIMEZONE = 'America/Lima';
// Lima is UTC-5 throughout the year. All dashboard boundaries use this zone.
const startOfDay = date => new Date(Math.floor((date.getTime() - 5 * 3600000) / DAY) * DAY + 5 * 3600000);
const dayKey = date => new Date(date.getTime() - 5 * 3600000).toISOString().slice(0, 10);
const periodFor = (days, now = new Date()) => {
    const end = startOfDay(now);
    const start = new Date(end.getTime() - days * DAY);
    return { start, end, previousStart: new Date(start.getTime() - days * DAY) };
};
const changePercent = (current, previous, complete) => complete && previous > 0
    ? Math.round(((current - previous) / previous) * 1000) / 10 : null;
const validSearchId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{12,100}$/.test(value);
const validDeviceId = value => typeof value === 'string' && value.length >= 4 && value.length <= 200 && !['null', 'undefined'].includes(value);
module.exports = { DAY, TIMEZONE, startOfDay, dayKey, periodFor, changePercent, validSearchId, validDeviceId };
