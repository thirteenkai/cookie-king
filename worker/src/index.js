// ============================================
// Cookie Share API — V3 (Owner Scoped)
// ============================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': [
    'Content-Type',
    'X-CK-Owner-Id',
    'X-CK-Owner-Token',
    'X-CK-Write-Token',
    'X-CK-Read-Token'
  ].join(', '),
  'Content-Type': 'application/json'
};

const TTL_SECONDS = 7 * 24 * 60 * 60;
// Keep headroom below Workers KV's 25 MiB value limit for metadata and JSON framing.
const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;
const MAX_KDF_ITERATIONS = 1000000;

const CHANNEL_ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const SITE_ID_RE = /^[a-z0-9][a-z0-9.-]{1,126}$/;
const OWNER_ID_RE = /^ow-[a-z0-9]{10,64}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,256}$/;

const RATE_LIMITS = {
  bootstrapIpPerDay: { limit: 60, windowSeconds: 24 * 60 * 60 },
  createByIpPerDay: { limit: 120, windowSeconds: 24 * 60 * 60 },
  createByOwnerPerDay: { limit: 30, windowSeconds: 24 * 60 * 60 },
  pushByIpPerHour: { limit: 1000, windowSeconds: 60 * 60 },
  pushByOwnerPerHour: { limit: 120, windowSeconds: 60 * 60 },
  pullByIpPerHour: { limit: 5000, windowSeconds: 60 * 60 },
  pullByChannelPerHour: { limit: 1200, windowSeconds: 60 * 60 },
  ownerListByIpPerHour: { limit: 3000, windowSeconds: 60 * 60 },
  ownerListByOwnerPerHour: { limit: 600, windowSeconds: 60 * 60 }
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, ...extraHeaders }
  });
}

function error(status, message, extra = {}, headers = {}) {
  return json({ error: message, ...extra }, status, headers);
}

function isValidChannelId(channelId) {
  return CHANNEL_ID_RE.test(channelId || '');
}

function isValidSiteId(siteId) {
  return SITE_ID_RE.test(siteId || '');
}

function isValidOwnerId(ownerId) {
  return OWNER_ID_RE.test(ownerId || '');
}

function isValidToken(token) {
  return TOKEN_RE.test(token || '');
}

function tinyHash(input = '') {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function logEvent(event, fields = {}) {
  console.log(JSON.stringify({
    event,
    time: new Date().toISOString(),
    ...fields
  }));
}

function randomFromAlphabet(length, alphabet) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function bytesToBase64Url(bytes) {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...part);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function generateOwnerId() {
  return `ow-${randomFromAlphabet(20, 'abcdefghijklmnopqrstuvwxyz0123456789')}`;
}

function generateChannelId() {
  return `ch-${randomFromAlphabet(16, 'abcdefghijkmnpqrstuvwxyz23456789')}`;
}

function generateToken(bytes = 24) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function parseJsonBody(request, maxBytes = Infinity) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return {
      ok: false,
      status: 413,
      error: 'Payload too large',
      maxBytes,
      receivedBytes: contentLength
    };
  }

  let text;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, error: 'Invalid request body' };
  }

  const receivedBytes = new TextEncoder().encode(text || '').byteLength;
  if (receivedBytes > maxBytes) {
    return {
      ok: false,
      status: 413,
      error: 'Payload too large',
      maxBytes,
      receivedBytes
    };
  }

  if (!text) return { ok: false, status: 400, error: 'Invalid JSON body' };

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON body' };
  }
}

// ----------------------
// V3 key helpers
// ----------------------

function v3OwnerMetaKey(ownerId) {
  return `v3:owners:${ownerId}:meta`;
}

function v3OwnerActiveIndexKey(ownerId) {
  return `v3:owners:${ownerId}:active-sites`;
}

function v3OwnerChannelIndexKey(ownerId) {
  return `v3:owners:${ownerId}:channels`;
}

function v3ChannelMetaKey(channelId) {
  return `v3:channels:${channelId}:meta`;
}

function v3ChannelSiteKey(channelId, siteId) {
  return `v3:channels:${channelId}:sites:${siteId}`;
}

function v3ChannelIndexKey(channelId) {
  return `v3:channels:${channelId}:index`;
}

function v3RateLimitKey(scope, identifier, bucket) {
  return `v3:ratelimit:${scope}:${tinyHash(identifier)}:${bucket}`;
}

async function readJsonObject(env, key) {
  const data = await env.COOKIE_STORE.get(key, 'json');
  if (!data || typeof data !== 'object') return {};
  return data;
}

async function writeJsonObject(env, key, value, ttlSeconds = 0) {
  if (!value || Object.keys(value).length === 0) {
    await env.COOKIE_STORE.delete(key);
    return;
  }

  const options = ttlSeconds > 0 ? { expirationTtl: ttlSeconds } : undefined;
  await env.COOKIE_STORE.put(key, JSON.stringify(value), options);
}

async function enforceRateLimit(env, scope, identifier, config) {
  if (!identifier) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(nowSec / config.windowSeconds);
  const key = v3RateLimitKey(scope, identifier, bucket);
  const existing = Number(await env.COOKIE_STORE.get(key));
  const count = Number.isFinite(existing) ? existing : 0;

  if (count >= config.limit) {
    const retryAfter = config.windowSeconds - (nowSec % config.windowSeconds);
    return {
      limited: true,
      retryAfter,
      reason: `${scope}:${identifier}`
    };
  }

  await env.COOKIE_STORE.put(key, String(count + 1), {
    expirationTtl: config.windowSeconds + 60
  });

  return null;
}

function rateLimitedResponse(meta) {
  return error(
    429,
    'Rate limit exceeded',
    { reason: meta?.reason || 'unknown' },
    { 'Retry-After': String(meta?.retryAfter || 60) }
  );
}

async function requireOwnerAuth(request, env) {
  const ownerId = (request.headers.get('X-CK-Owner-Id') || '').trim().toLowerCase();
  const ownerToken = (request.headers.get('X-CK-Owner-Token') || '').trim();

  if (!isValidOwnerId(ownerId) || !isValidToken(ownerToken)) {
    return { error: error(401, 'Unauthorized owner') };
  }

  const ownerMeta = await env.COOKIE_STORE.get(v3OwnerMetaKey(ownerId), 'json');
  if (!ownerMeta || ownerMeta.ownerToken !== ownerToken) {
    return { error: error(401, 'Unauthorized owner') };
  }

  return { ownerId, ownerMeta };
}

async function readV3ChannelMeta(env, channelId) {
  const data = await env.COOKIE_STORE.get(v3ChannelMetaKey(channelId), 'json');
  if (!data || typeof data !== 'object') return null;
  return data;
}

async function writeV3ChannelMeta(env, channelId, data) {
  await env.COOKIE_STORE.put(v3ChannelMetaKey(channelId), JSON.stringify(data));
}

async function readV3ChannelIndex(env, channelId) {
  return readJsonObject(env, v3ChannelIndexKey(channelId));
}

async function writeV3ChannelIndex(env, channelId, indexData) {
  await writeJsonObject(env, v3ChannelIndexKey(channelId), indexData, TTL_SECONDS);
}

async function compactV3ChannelIndex(env, channelId, indexData) {
  const entries = Object.entries(indexData || {});
  if (entries.length === 0) return {};

  const result = {};
  for (const [siteId, meta] of entries) {
    const updatedAtMs = Date.parse(meta?.updatedAt || '');
    if (Number.isFinite(updatedAtMs) && updatedAtMs > Date.now() - TTL_SECONDS * 1000) {
      result[siteId] = meta;
    }
  }

  if (Object.keys(result).length !== entries.length) {
    await writeV3ChannelIndex(env, channelId, result);
  }

  return result;
}

async function readV3OwnerActiveIndex(env, ownerId) {
  return readJsonObject(env, v3OwnerActiveIndexKey(ownerId));
}

async function writeV3OwnerActiveIndex(env, ownerId, indexData) {
  await writeJsonObject(env, v3OwnerActiveIndexKey(ownerId), indexData);
}

async function compactV3OwnerActiveIndex(env, ownerId, indexData) {
  const entries = Object.entries(indexData || {});
  if (entries.length === 0) return {};

  const result = {};

  for (const [siteId, meta] of entries) {
    const channelId = meta?.channelId;
    if (!isValidChannelId(channelId)) continue;

    const channelMeta = await readV3ChannelMeta(env, channelId);
    if (!channelMeta || channelMeta.ownerId !== ownerId) continue;

    const updatedAtMs = Date.parse(meta?.updatedAt || '');
    if (Number.isFinite(updatedAtMs) && updatedAtMs > Date.now() - TTL_SECONDS * 1000) {
      result[siteId] = meta;
    }
  }

  if (Object.keys(result).length !== entries.length) {
    await writeV3OwnerActiveIndex(env, ownerId, result);
  }

  return result;
}

async function readV3OwnerChannelIndex(env, ownerId) {
  return readJsonObject(env, v3OwnerChannelIndexKey(ownerId));
}

async function writeV3OwnerChannelIndex(env, ownerId, indexData) {
  await writeJsonObject(env, v3OwnerChannelIndexKey(ownerId), indexData);
}

async function requireWriteAccess(request, env, channelId, ownerId) {
  const channelMeta = await readV3ChannelMeta(env, channelId);
  if (!channelMeta) return { error: error(404, 'Channel not found') };

  if (channelMeta.ownerId !== ownerId) {
    return { error: error(403, 'Channel owner mismatch') };
  }

  const writeToken = (request.headers.get('X-CK-Write-Token') || '').trim();
  if (!isValidToken(writeToken) || writeToken !== channelMeta.writeToken) {
    return { error: error(403, 'Invalid write token') };
  }

  return { channelMeta };
}

async function requireReadAccess(request, env, channelId) {
  const channelMeta = await readV3ChannelMeta(env, channelId);
  if (!channelMeta) return { error: error(404, 'Channel not found') };

  const readToken = (request.headers.get('X-CK-Read-Token') || '').trim();

  if (!isValidToken(readToken) || readToken !== channelMeta.readToken) {
    return { error: error(403, 'Invalid read token') };
  }

  return { channelMeta };
}

async function parseAndValidateEnvelope(request, siteId) {
  const parsed = await parseJsonBody(request, MAX_SNAPSHOT_BYTES);
  if (!parsed.ok) {
    return {
      error: error(parsed.status, parsed.error, {
        maxBytes: parsed.maxBytes || undefined,
        receivedBytes: parsed.receivedBytes || undefined
      })
    };
  }

  const validationError = validateEnvelope(parsed.value, siteId);
  if (validationError) return { error: error(400, validationError) };

  return { payload: parsed.value };
}

function normalizeSiteMeta(siteId, meta) {
  return {
    siteId,
    channelId: meta?.channelId || '',
    updatedAt: meta?.updatedAt || null,
    strategy: meta?.strategy || 'UNKNOWN',
    riskLevel: meta?.riskLevel || 'UNKNOWN',
    supportLevel: meta?.supportLevel || 'UNKNOWN'
  };
}

function sortByUpdatedAtDesc(a, b) {
  if (!a.updatedAt && !b.updatedAt) return 0;
  if (!a.updatedAt) return 1;
  if (!b.updatedAt) return -1;
  return b.updatedAt.localeCompare(a.updatedAt);
}

function validateEnvelope(payload, pathSiteId) {
  if (!payload || typeof payload !== 'object') return 'Body must be a JSON object';

  const { envelopeVersion, alg, kdf, iv, ciphertext, metadata } = payload;

  if (!['2', '3'].includes(String(envelopeVersion || ''))) return 'Unsupported envelopeVersion';
  if (alg !== 'AES-GCM') return 'alg must be AES-GCM';

  if (!kdf || typeof kdf !== 'object') return 'Missing kdf';
  if (typeof kdf.s !== 'string' || !kdf.s) return 'kdf.s must be base64 string';
  if (!Number.isInteger(kdf.i) || kdf.i < 100000 || kdf.i > MAX_KDF_ITERATIONS) {
    return 'kdf.i must be integer between 100000 and 1000000';
  }
  if (kdf.h !== 'SHA-256') return 'kdf.h must be SHA-256';

  if (typeof iv !== 'string' || !iv) return 'Missing iv';
  if (typeof ciphertext !== 'string' || !ciphertext) return 'Missing ciphertext';

  if (!metadata || typeof metadata !== 'object') return 'Missing metadata';
  if (typeof metadata.siteId !== 'string' || !metadata.siteId) return 'metadata.siteId is required';
  if (metadata.siteId !== pathSiteId) return 'metadata.siteId mismatch path';
  if (typeof metadata.capturedAt !== 'string' || !metadata.capturedAt) return 'metadata.capturedAt is required';

  return null;
}

// ----------------------
// Main handler
// ----------------------

async function handleRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (path === '/api/health' && request.method === 'GET') {
      return json({
        status: 'ok',
        time: new Date().toISOString(),
        version: 'v3',
        maxSnapshotBytes: MAX_SNAPSHOT_BYTES,
        channelSiteDiscovery: true
      });
    }

    // -------- V3 --------

    if (path === '/api/v3/owners/bootstrap' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const ipRate = await enforceRateLimit(env, 'bootstrap-ip', ip, RATE_LIMITS.bootstrapIpPerDay);
      if (ipRate?.limited) return rateLimitedResponse(ipRate);

      const ownerId = generateOwnerId();
      const ownerToken = generateToken();
      const now = new Date().toISOString();

      await env.COOKIE_STORE.put(v3OwnerMetaKey(ownerId), JSON.stringify({ ownerId, ownerToken, createdAt: now, updatedAt: now }));

      logEvent('owner.bootstrap', {
        status: 'ok',
        ownerHash: tinyHash(ownerId),
        ipHash: tinyHash(ip)
      });

      return json({ ownerId, ownerToken, createdAt: now });
    }

    if (path === '/api/v3/channels' && request.method === 'POST') {
      const auth = await requireOwnerAuth(request, env);
      if (auth.error) return auth.error;

      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const ipRate = await enforceRateLimit(env, 'create-ip', ip, RATE_LIMITS.createByIpPerDay);
      if (ipRate?.limited) return rateLimitedResponse(ipRate);

      const ownerRate = await enforceRateLimit(env, 'create-owner', auth.ownerId, RATE_LIMITS.createByOwnerPerDay);
      if (ownerRate?.limited) return rateLimitedResponse(ownerRate);

      let channelId = '';
      for (let i = 0; i < 6; i += 1) {
        const candidate = generateChannelId();
        const exists = await env.COOKIE_STORE.get(v3ChannelMetaKey(candidate));
        if (!exists) {
          channelId = candidate;
          break;
        }
      }

      if (!channelId) {
        return error(409, 'Failed to allocate unique channel ID');
      }

      const readToken = generateToken();
      const writeToken = generateToken();
      const now = new Date().toISOString();

      await writeV3ChannelMeta(env, channelId, {
        channelId,
        ownerId: auth.ownerId,
        readToken,
        writeToken,
        createdAt: now,
        updatedAt: now
      });

      const ownerChannels = await readV3OwnerChannelIndex(env, auth.ownerId);
      ownerChannels[channelId] = {
        createdAt: now,
        updatedAt: now
      };
      await writeV3OwnerChannelIndex(env, auth.ownerId, ownerChannels);

      logEvent('channel.create', {
        status: 'ok',
        ownerHash: tinyHash(auth.ownerId),
        channelId
      });

      return json({
        channelId,
        readToken,
        writeToken,
        createdAt: now
      });
    }

    if (path === '/api/v3/owners/sites' && request.method === 'GET') {
      const auth = await requireOwnerAuth(request, env);
      if (auth.error) return auth.error;

      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const ipRate = await enforceRateLimit(env, 'list-ip', ip, RATE_LIMITS.ownerListByIpPerHour);
      if (ipRate?.limited) return rateLimitedResponse(ipRate);

      const ownerRate = await enforceRateLimit(env, 'list-owner', auth.ownerId, RATE_LIMITS.ownerListByOwnerPerHour);
      if (ownerRate?.limited) return rateLimitedResponse(ownerRate);

      const rawActive = await readV3OwnerActiveIndex(env, auth.ownerId);
      const active = await compactV3OwnerActiveIndex(env, auth.ownerId, rawActive);

      const sites = Object.entries(active)
        .map(([siteId, meta]) => normalizeSiteMeta(siteId, meta))
        .sort(sortByUpdatedAtDesc);

      logEvent('owner.sites.list', {
        status: 'ok',
        ownerHash: tinyHash(auth.ownerId),
        count: sites.length
      });

      return json({ ownerId: auth.ownerId, sites });
    }

    if (path === '/api/v3/owners/sites' && request.method === 'DELETE') {
      const auth = await requireOwnerAuth(request, env);
      if (auth.error) return auth.error;

      const rawActive = await readV3OwnerActiveIndex(env, auth.ownerId);
      const active = await compactV3OwnerActiveIndex(env, auth.ownerId, rawActive);

      let deletedSiteCount = 0;

      for (const [siteId, meta] of Object.entries(active)) {
        const channelId = meta?.channelId;
        if (!isValidChannelId(channelId)) continue;

        const channelMeta = await readV3ChannelMeta(env, channelId);
        if (!channelMeta || channelMeta.ownerId !== auth.ownerId) continue;

        await env.COOKIE_STORE.delete(v3ChannelSiteKey(channelId, siteId));

        const channelIndex = await readV3ChannelIndex(env, channelId);
        if (channelIndex[siteId]) {
          delete channelIndex[siteId];
          await writeV3ChannelIndex(env, channelId, channelIndex);
        }

        deletedSiteCount += 1;
      }

      await env.COOKIE_STORE.delete(v3OwnerActiveIndexKey(auth.ownerId));

      logEvent('owner.sites.clear', {
        status: 'ok',
        ownerHash: tinyHash(auth.ownerId),
        deletedSiteCount
      });

      return json({ success: true, ownerId: auth.ownerId, deletedSiteCount });
    }

    const v3ChannelSitesMatch = path.match(/^\/api\/v3\/channels\/([a-z0-9-]+)\/sites$/);
    if (v3ChannelSitesMatch && request.method === 'GET') {
      const channelId = v3ChannelSitesMatch[1];
      if (!isValidChannelId(channelId)) return error(400, 'Invalid channelId');

      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const ipRate = await enforceRateLimit(env, 'pull-ip', ip, RATE_LIMITS.pullByIpPerHour);
      if (ipRate?.limited) return rateLimitedResponse(ipRate);

      const channelRate = await enforceRateLimit(env, 'pull-channel', channelId, RATE_LIMITS.pullByChannelPerHour);
      if (channelRate?.limited) return rateLimitedResponse(channelRate);

      const read = await requireReadAccess(request, env, channelId);
      if (read.error) return read.error;

      const rawIndex = await readV3ChannelIndex(env, channelId);
      const active = await compactV3ChannelIndex(env, channelId, rawIndex);
      const sites = Object.entries(active)
        .map(([siteId, meta]) => ({ siteId, updatedAt: meta?.updatedAt || null }))
        .sort(sortByUpdatedAtDesc);

      logEvent('channel.sites.list', {
        status: 'ok',
        channelId,
        count: sites.length
      });

      return json({ channelId, sites });
    }

    const v3SiteMatch = path.match(/^\/api\/v3\/channels\/([a-z0-9-]+)\/sites\/([a-z0-9.-]+)$/);
    if (v3SiteMatch) {
      const channelId = v3SiteMatch[1];
      const siteId = v3SiteMatch[2];

      if (!isValidChannelId(channelId)) return error(400, 'Invalid channelId');
      if (!isValidSiteId(siteId)) return error(400, 'Invalid siteId');

      if (request.method === 'GET') {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const ipRate = await enforceRateLimit(env, 'pull-ip', ip, RATE_LIMITS.pullByIpPerHour);
        if (ipRate?.limited) return rateLimitedResponse(ipRate);

        const channelRate = await enforceRateLimit(env, 'pull-channel', channelId, RATE_LIMITS.pullByChannelPerHour);
        if (channelRate?.limited) return rateLimitedResponse(channelRate);

        const read = await requireReadAccess(request, env, channelId);
        if (read.error) return read.error;

        const data = await env.COOKIE_STORE.get(v3ChannelSiteKey(channelId, siteId), 'json');
        if (!data) return error(404, 'Snapshot not found or expired');

        logEvent('snapshot.pull', {
          status: 'ok',
          channelId,
          siteId
        });

        return json({
          channelId,
          siteId,
          ...data
        });
      }

      if (request.method === 'PUT') {
        const parsed = await parseAndValidateEnvelope(request, siteId);
        if (parsed.error) return parsed.error;

        const auth = await requireOwnerAuth(request, env);
        if (auth.error) return auth.error;

        const write = await requireWriteAccess(request, env, channelId, auth.ownerId);
        if (write.error) return write.error;

        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const ipRate = await enforceRateLimit(env, 'push-ip', ip, RATE_LIMITS.pushByIpPerHour);
        if (ipRate?.limited) return rateLimitedResponse(ipRate);

        const ownerRate = await enforceRateLimit(env, 'push-owner', auth.ownerId, RATE_LIMITS.pushByOwnerPerHour);
        if (ownerRate?.limited) return rateLimitedResponse(ownerRate);

        const body = parsed.payload;
        const updatedAt = new Date().toISOString();

        const payload = {
          envelopeVersion: body.envelopeVersion,
          alg: body.alg,
          kdf: body.kdf,
          iv: body.iv,
          ciphertext: body.ciphertext,
          metadata: {
            ...body.metadata,
            siteId
          },
          updatedAt
        };

        await env.COOKIE_STORE.put(v3ChannelSiteKey(channelId, siteId), JSON.stringify(payload), {
          expirationTtl: TTL_SECONDS
        });

        const channelIndexRaw = await readV3ChannelIndex(env, channelId);
        const channelIndex = await compactV3ChannelIndex(env, channelId, channelIndexRaw);
        channelIndex[siteId] = {
          updatedAt,
          strategy: payload.metadata.strategy || 'UNKNOWN',
          riskLevel: payload.metadata.riskLevel || 'UNKNOWN',
          supportLevel: payload.metadata.supportLevel || 'UNKNOWN'
        };
        await writeV3ChannelIndex(env, channelId, channelIndex);

        const ownerActiveRaw = await readV3OwnerActiveIndex(env, auth.ownerId);
        const ownerActive = await compactV3OwnerActiveIndex(env, auth.ownerId, ownerActiveRaw);

        let overwrittenFromChannelId = '';
        const previous = ownerActive[siteId];
        if (previous?.channelId && previous.channelId !== channelId) {
          overwrittenFromChannelId = previous.channelId;

          await env.COOKIE_STORE.delete(v3ChannelSiteKey(previous.channelId, siteId));

          const oldIndexRaw = await readV3ChannelIndex(env, previous.channelId);
          const oldIndex = await compactV3ChannelIndex(env, previous.channelId, oldIndexRaw);
          if (oldIndex[siteId]) {
            delete oldIndex[siteId];
            await writeV3ChannelIndex(env, previous.channelId, oldIndex);
          }
        }

        ownerActive[siteId] = {
          channelId,
          updatedAt,
          strategy: payload.metadata.strategy || 'UNKNOWN',
          riskLevel: payload.metadata.riskLevel || 'UNKNOWN',
          supportLevel: payload.metadata.supportLevel || 'UNKNOWN'
        };
        await writeV3OwnerActiveIndex(env, auth.ownerId, ownerActive);

        const ownerChannels = await readV3OwnerChannelIndex(env, auth.ownerId);
        ownerChannels[channelId] = {
          ...(ownerChannels[channelId] || {}),
          updatedAt,
          createdAt: ownerChannels[channelId]?.createdAt || write.channelMeta.createdAt || updatedAt
        };
        await writeV3OwnerChannelIndex(env, auth.ownerId, ownerChannels);

        await writeV3ChannelMeta(env, channelId, {
          ...write.channelMeta,
          updatedAt
        });

        logEvent('snapshot.push', {
          status: 'ok',
          ownerHash: tinyHash(auth.ownerId),
          channelId,
          siteId,
          overwritten: Boolean(overwrittenFromChannelId)
        });

        return json({
          channelId,
          siteId,
          updatedAt,
          riskLevel: channelIndex[siteId].riskLevel,
          strategy: channelIndex[siteId].strategy,
          supportLevel: channelIndex[siteId].supportLevel,
          overwrittenFromChannelId: overwrittenFromChannelId || null
        });
      }

      if (request.method === 'DELETE') {
        const auth = await requireOwnerAuth(request, env);
        if (auth.error) return auth.error;

        const write = await requireWriteAccess(request, env, channelId, auth.ownerId);
        if (write.error) return write.error;

        await env.COOKIE_STORE.delete(v3ChannelSiteKey(channelId, siteId));

        const channelIndex = await readV3ChannelIndex(env, channelId);
        if (channelIndex[siteId]) {
          delete channelIndex[siteId];
          await writeV3ChannelIndex(env, channelId, channelIndex);
        }

        const ownerActive = await readV3OwnerActiveIndex(env, auth.ownerId);
        if (ownerActive[siteId]?.channelId === channelId) {
          delete ownerActive[siteId];
          await writeV3OwnerActiveIndex(env, auth.ownerId, ownerActive);
        }

        logEvent('snapshot.delete', {
          status: 'ok',
          ownerHash: tinyHash(auth.ownerId),
          channelId,
          siteId
        });

        return json({ success: true, channelId, siteId });
      }

      return error(405, 'Method not allowed');
    }

    const v3ChannelMatch = path.match(/^\/api\/v3\/channels\/([a-z0-9-]+)$/);
    if (v3ChannelMatch && request.method === 'DELETE') {
      const channelId = v3ChannelMatch[1];
      if (!isValidChannelId(channelId)) return error(400, 'Invalid channelId');

      const auth = await requireOwnerAuth(request, env);
      if (auth.error) return auth.error;

      const write = await requireWriteAccess(request, env, channelId, auth.ownerId);
      if (write.error) return write.error;

      const rawIndex = await readV3ChannelIndex(env, channelId);
      const index = await compactV3ChannelIndex(env, channelId, rawIndex);
      const siteIds = Object.keys(index);

      await Promise.all(siteIds.map((siteId) => env.COOKIE_STORE.delete(v3ChannelSiteKey(channelId, siteId))));
      await env.COOKIE_STORE.delete(v3ChannelIndexKey(channelId));
      await env.COOKIE_STORE.delete(v3ChannelMetaKey(channelId));

      const ownerActive = await readV3OwnerActiveIndex(env, auth.ownerId);
      let ownerActiveChanged = false;
      for (const [siteId, meta] of Object.entries(ownerActive)) {
        if (meta?.channelId === channelId) {
          delete ownerActive[siteId];
          ownerActiveChanged = true;
        }
      }
      if (ownerActiveChanged) {
        await writeV3OwnerActiveIndex(env, auth.ownerId, ownerActive);
      }

      const ownerChannels = await readV3OwnerChannelIndex(env, auth.ownerId);
      if (ownerChannels[channelId]) {
        delete ownerChannels[channelId];
        await writeV3OwnerChannelIndex(env, auth.ownerId, ownerChannels);
      }

      logEvent('channel.delete', {
        status: 'ok',
        ownerHash: tinyHash(auth.ownerId),
        channelId,
        deletedSiteCount: siteIds.length
      });

      return json({ success: true, channelId, deletedSiteCount: siteIds.length });
    }

    return error(404, 'Not found');
}

function isSnapshotPayloadKey(key) {
  return /^v3:channels:[^:]+:sites:[^:]+$/.test(String(key || ''));
}

class CoordinatedMetadataStore {
  constructor(storage, snapshotStore) {
    this.storage = storage;
    this.snapshotStore = snapshotStore;
  }

  async get(key, type) {
    if (isSnapshotPayloadKey(key)) {
      return this.snapshotStore.get(key, type);
    }

    let record = await this.storage.get(key);
    if (record === undefined || record === null) {
      const legacyValue = await this.snapshotStore.get(key);
      if (legacyValue === null || legacyValue === undefined) return null;
      record = { value: String(legacyValue), expiresAt: 0 };
      await this.storage.put(key, record);
    }

    const normalizedRecord = record && typeof record === 'object' && 'value' in record
      ? record
      : { value: String(record), expiresAt: 0 };
    const expiresAt = Number(normalizedRecord.expiresAt || 0);
    if (expiresAt > 0 && expiresAt <= Date.now()) {
      await this.storage.delete(key);
      return null;
    }

    const raw = String(normalizedRecord.value ?? '');
    if (type === 'json') {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    return raw;
  }

  async put(key, value, options = {}) {
    if (isSnapshotPayloadKey(key)) {
      return this.snapshotStore.put(key, value, options);
    }

    const ttlSeconds = Number(options?.expirationTtl || 0);
    const expiresAt = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0;
    await this.storage.put(key, {
      value: String(value),
      expiresAt
    });
  }

  async delete(key) {
    if (isSnapshotPayloadKey(key)) {
      return this.snapshotStore.delete(key);
    }

    await Promise.all([
      this.storage.delete(key),
      this.snapshotStore.delete(key)
    ]);
  }
}

export class CookieKingCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.queue = Promise.resolve();
  }

  fetch(request) {
    const task = this.queue.then(() => {
      const coordinatedEnv = {
        ...this.env,
        COOKIE_STORE: new CoordinatedMetadataStore(this.state.storage, this.env.COOKIE_STORE)
      };
      return handleRequest(request, coordinatedEnv);
    });

    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }
}

let fallbackQueue = Promise.resolve();

function handleWithFallbackQueue(request, env) {
  const task = fallbackQueue.then(() => handleRequest(request, env));
  fallbackQueue = task.then(() => undefined, () => undefined);
  return task;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/v3/')) {
      return handleRequest(request, env);
    }

    if (!env.COORDINATOR) {
      if (env.ALLOW_UNCOORDINATED_FOR_TESTS === true) {
        return handleWithFallbackQueue(request, env);
      }
      return error(503, 'COORDINATOR binding is required');
    }

    const id = env.COORDINATOR.idFromName('cookie-king-global-v1');
    const stub = env.COORDINATOR.get(id);
    return stub.fetch(request);
  }
};
