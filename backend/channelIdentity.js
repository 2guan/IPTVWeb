import crypto from 'node:crypto';

export function normalizeIdentityText(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\r/g, '')
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function normalizeExternalId(value = '') {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_.:-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function hashIdentity(value = '') {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 16);
}

function addSignature(signatures, value) {
  if (!value || signatures.includes(value)) return;
  signatures.push(value);
}

function normalizeUrlSignature(url = '') {
  const normalized = String(url || '').trim().toLowerCase();
  return normalized ? hashIdentity(normalized) : '';
}

export function getChannelIdentitySignatures({
  tvg_id,
  tvgId,
  name,
  category,
  origin,
  subscription_id,
  subscriptionId,
  subscription_name,
  subscriptionName,
  url,
  pid
} = {}) {
  const signatures = [];
  const externalId = normalizeExternalId(tvg_id || tvgId);
  const normalizedName = normalizeIdentityText(name);
  const normalizedCategory = normalizeIdentityText(category);
  const normalizedUrl = normalizeUrlSignature(url);
  const sourceOrigin = String(origin || '').trim().toLowerCase();
  const subId = subscription_id ?? subscriptionId ?? '';
  const normalizedSubscriptionName = normalizeIdentityText(subscription_name || subscriptionName);

  addSignature(signatures, externalId ? `external:${externalId.toLowerCase()}` : '');
  addSignature(signatures, sourceOrigin === 'migu' && pid ? `migu:pid:${pid}` : '');
  addSignature(signatures, sourceOrigin === 'migu' && normalizedName ? `migu:name:${normalizedName}` : '');
  addSignature(signatures, subId && normalizedName ? `subscription:${subId}:name:${normalizedName}` : '');
  addSignature(signatures, normalizedSubscriptionName && normalizedName ? `subscription-name:${normalizedSubscriptionName}:name:${normalizedName}` : '');
  addSignature(signatures, sourceOrigin && normalizedName ? `origin:${sourceOrigin}:name:${normalizedName}` : '');
  addSignature(signatures, normalizedName ? `name:${normalizedName}` : '');
  addSignature(signatures, normalizedName && normalizedCategory ? `name-category:${normalizedName}:${normalizedCategory}` : '');
  addSignature(signatures, subId && normalizedUrl ? `subscription:${subId}:url:${normalizedUrl}` : '');
  addSignature(signatures, normalizedUrl ? `url:${normalizedUrl}` : '');

  return signatures;
}

export function buildChannelId({
  tvg_id,
  tvgId,
  name,
  category,
  origin,
  subscription_id,
  subscriptionId,
  url,
  pid
} = {}) {
  const externalId = normalizeExternalId(tvg_id || tvgId);
  if (externalId) return externalId;

  const normalizedName = normalizeIdentityText(name);
  const normalizedCategory = normalizeIdentityText(category);
  const normalizedUrl = normalizeIdentityText(url);
  const sourceOrigin = String(origin || '').trim().toLowerCase();
  const subId = subscription_id ?? subscriptionId ?? '';

  let scope = '';
  if (sourceOrigin === 'migu' && pid) {
    scope = `migu:${pid}`;
  } else if (sourceOrigin === 'migu') {
    scope = `migu:${normalizedName || normalizedUrl}`;
  } else if (subId) {
    scope = `sub:${subId}:${normalizedName || normalizedUrl}`;
  } else {
    scope = `manual:${normalizedName || normalizedCategory || normalizedUrl}`;
  }

  return `iptv-${hashIdentity(scope || normalizedUrl || normalizedName || 'unknown')}`;
}

export function ensureChannelId(row = {}) {
  const existing = normalizeExternalId(row.channel_id);
  return existing || buildChannelId(row);
}
