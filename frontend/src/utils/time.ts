const BEIJING_TIME_ZONE = 'Asia/Shanghai';

function parseTimeValue(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const text = String(value).trim();
  if (!text) return null;

  const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(text);
  const normalized = text.replace(' ', 'T');
  const date = new Date(hasTimezone ? normalized : `${normalized}+08:00`);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatBeijingTime(value: string | number | Date | null | undefined) {
  const date = parseTimeValue(value);
  if (!date) return '';

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING_TIME_ZONE,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '00';
  return `${getPart('month')}-${getPart('day')} ${getPart('hour')}:${getPart('minute')}:${getPart('second')}`;
}

export function isFutureBeijingTime(value: string | number | Date | null | undefined) {
  const date = parseTimeValue(value);
  return date ? date.getTime() > Date.now() : false;
}
