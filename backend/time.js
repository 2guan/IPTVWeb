export const BEIJING_NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%S+08:00', 'now', '+8 hours')";

export function formatBeijingIsoAfterHours(hours = 0) {
  const shifted = new Date(Date.now() + (Number(hours) + 8) * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 19)}+08:00`;
}
