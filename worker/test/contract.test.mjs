import assert from 'node:assert/strict';
import worker, { CookieKingCoordinator } from '../src/index.js';

class MemoryKV {
  constructor() {
    this.store = new Map();
  }

  async get(key, type) {
    if (!this.store.has(key)) return null;
    const value = this.store.get(key);

    if (type === 'json') {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }

    return value;
  }

  async put(key, value) {
    this.store.set(key, value);
  }

  async delete(key) {
    this.store.delete(key);
  }
}

class MemoryDurableStorage {
  constructor() {
    this.store = new Map();
  }

  async get(key) {
    return this.store.get(key);
  }

  async put(key, value) {
    this.store.set(key, value);
  }

  async delete(key) {
    this.store.delete(key);
  }
}

class MemoryCoordinatorNamespace {
  constructor(getEnv) {
    this.getEnv = getEnv;
    this.instances = new Map();
  }

  idFromName(name) {
    return name;
  }

  get(id) {
    if (!this.instances.has(id)) {
      const state = { storage: new MemoryDurableStorage() };
      this.instances.set(id, new CookieKingCoordinator(state, this.getEnv()));
    }
    return this.instances.get(id);
  }
}

function createEnv() {
  const env = { COOKIE_STORE: new MemoryKV() };
  env.COORDINATOR = new MemoryCoordinatorNamespace(() => env);
  return env;
}

function createEnvelope(siteId) {
  return {
    envelopeVersion: '2',
    alg: 'AES-GCM',
    kdf: {
      s: 'c2FsdA==',
      i: 210000,
      h: 'SHA-256'
    },
    iv: 'aXY=',
    ciphertext: 'Y2lwaGVy',
    metadata: {
      siteId,
      capturedAt: new Date().toISOString(),
      strategy: 'COOKIE_PLUS_STORAGE',
      riskLevel: 'LOW',
      supportLevel: 'SUPPORTED'
    }
  };
}

async function call(env, path, method = 'GET', body = null, rawBody = null, headers = {}) {
  const request = new Request(`https://unit.test${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: rawBody ?? (body ? JSON.stringify(body) : undefined)
  });
  return worker.fetch(request, env);
}

async function readJson(response) {
  return response.json();
}

function ownerHeaders(owner) {
  return {
    'X-CK-Owner-Id': owner.ownerId,
    'X-CK-Owner-Token': owner.ownerToken
  };
}

function writeHeaders(owner, channel) {
  return {
    ...ownerHeaders(owner),
    'X-CK-Write-Token': channel.writeToken
  };
}

function readHeaders(channel) {
  return {
    'X-CK-Read-Token': channel.readToken
  };
}

async function bootstrapOwner(env) {
  const res = await call(env, '/api/v3/owners/bootstrap', 'POST');
  assert.equal(res.status, 200);
  return readJson(res);
}

async function createChannel(env, owner) {
  const res = await call(env, '/api/v3/channels', 'POST', null, null, ownerHeaders(owner));
  assert.equal(res.status, 200);
  return readJson(res);
}

async function run() {
  {
    const uncoordinatedEnv = { COOKIE_STORE: new MemoryKV() };
    const rejected = await call(uncoordinatedEnv, '/api/v3/owners/bootstrap', 'POST');
    assert.equal(rejected.status, 503);
  }

  const env = createEnv();

  // health
  {
    const res = await call(env, '/api/health');
    assert.equal(res.status, 200);
    const payload = await readJson(res);
    assert.equal(payload.status, 'ok');
    assert.equal(payload.version, 'v3');
    assert.equal(payload.maxSnapshotBytes, 20 * 1024 * 1024);
    assert.equal(payload.channelSiteDiscovery, true);
  }

  const ownerA = await bootstrapOwner(env);
  const ownerB = await bootstrapOwner(env);

  const channelA1 = await createChannel(env, ownerA);
  const channelA2 = await createChannel(env, ownerA);
  const channelB1 = await createChannel(env, ownerB);

  // v3 write + read
  {
    const put = await call(
      env,
      `/api/v3/channels/${channelA1.channelId}/sites/example.com`,
      'PUT',
      createEnvelope('example.com'),
      null,
      writeHeaders(ownerA, channelA1)
    );
    assert.equal(put.status, 200);

    const get = await call(
      env,
      `/api/v3/channels/${channelA1.channelId}/sites/example.com`,
      'GET',
      null,
      null,
      readHeaders(channelA1)
    );
    assert.equal(get.status, 200);

    const list = await call(
      env,
      `/api/v3/channels/${channelA1.channelId}/sites`,
      'GET',
      null,
      null,
      readHeaders(channelA1)
    );
    assert.equal(list.status, 200);
    const listPayload = await readJson(list);
    assert.deepEqual(listPayload.sites.map((item) => item.siteId), ['example.com']);

    const forbiddenList = await call(
      env,
      `/api/v3/channels/${channelA1.channelId}/sites`,
      'GET',
      null,
      null,
      { 'X-CK-Read-Token': 'bad-token' }
    );
    assert.equal(forbiddenList.status, 403);
  }

  // Cookie+Storage snapshots commonly exceed the old 512 KiB ceiling.
  {
    const largeEnvelope = {
      ...createEnvelope('large.example'),
      ciphertext: 'A'.repeat(600 * 1024)
    };
    const put = await call(
      env,
      `/api/v3/channels/${channelA1.channelId}/sites/large.example`,
      'PUT',
      largeEnvelope,
      null,
      writeHeaders(ownerA, channelA1)
    );
    assert.equal(put.status, 200);
    const remove = await call(
      env,
      `/api/v3/channels/${channelA1.channelId}/sites/large.example`,
      'DELETE',
      null,
      null,
      writeHeaders(ownerA, channelA1)
    );
    assert.equal(remove.status, 200);
  }

  {
    const tooLarge = await call(
      env,
      `/api/v3/channels/${channelA1.channelId}/sites/oversize.example`,
      'PUT',
      createEnvelope('oversize.example'),
      null,
      {
        ...writeHeaders(ownerA, channelA1),
        'Content-Length': String(20 * 1024 * 1024 + 1)
      }
    );
    assert.equal(tooLarge.status, 413);
    const payload = await readJson(tooLarge);
    assert.equal(payload.maxBytes, 20 * 1024 * 1024);
  }

  // same owner + same site: new channel overrides old channel
  {
    const put = await call(
      env,
      `/api/v3/channels/${channelA2.channelId}/sites/example.com`,
      'PUT',
      createEnvelope('example.com'),
      null,
      writeHeaders(ownerA, channelA2)
    );
    assert.equal(put.status, 200);
    const payload = await readJson(put);
    assert.equal(payload.overwrittenFromChannelId, channelA1.channelId);

    const oldRead = await call(
      env,
      `/api/v3/channels/${channelA1.channelId}/sites/example.com`,
      'GET',
      null,
      null,
      readHeaders(channelA1)
    );
    assert.equal(oldRead.status, 404);

    const newRead = await call(
      env,
      `/api/v3/channels/${channelA2.channelId}/sites/example.com`,
      'GET',
      null,
      null,
      readHeaders(channelA2)
    );
    assert.equal(newRead.status, 200);
  }

  // different owner + same site: no overwrite across owners
  {
    const put = await call(
      env,
      `/api/v3/channels/${channelB1.channelId}/sites/example.com`,
      'PUT',
      createEnvelope('example.com'),
      null,
      writeHeaders(ownerB, channelB1)
    );
    assert.equal(put.status, 200);

    const readA = await call(
      env,
      `/api/v3/channels/${channelA2.channelId}/sites/example.com`,
      'GET',
      null,
      null,
      readHeaders(channelA2)
    );
    assert.equal(readA.status, 200);

    const readB = await call(
      env,
      `/api/v3/channels/${channelB1.channelId}/sites/example.com`,
      'GET',
      null,
      null,
      readHeaders(channelB1)
    );
    assert.equal(readB.status, 200);
  }

  // owner active list dedup by site
  {
    const listA = await call(env, '/api/v3/owners/sites', 'GET', null, null, ownerHeaders(ownerA));
    assert.equal(listA.status, 200);
    const payloadA = await readJson(listA);
    assert.equal(payloadA.sites.length, 1);
    assert.equal(payloadA.sites[0].siteId, 'example.com');
    assert.equal(payloadA.sites[0].channelId, channelA2.channelId);

    const listB = await call(env, '/api/v3/owners/sites', 'GET', null, null, ownerHeaders(ownerB));
    assert.equal(listB.status, 200);
    const payloadB = await readJson(listB);
    assert.equal(payloadB.sites.length, 1);
    assert.equal(payloadB.sites[0].channelId, channelB1.channelId);
  }

  // auth failures
  {
    const badOwner = await call(env, '/api/v3/owners/sites', 'GET', null, null, {
      'X-CK-Owner-Id': ownerA.ownerId,
      'X-CK-Owner-Token': 'bad-token'
    });
    assert.equal(badOwner.status, 401);

    const badWrite = await call(
      env,
      `/api/v3/channels/${channelA2.channelId}/sites/demo.com`,
      'PUT',
      createEnvelope('demo.com'),
      null,
      {
        ...ownerHeaders(ownerA),
        'X-CK-Write-Token': 'bad-write-token'
      }
    );
    assert.equal(badWrite.status, 403);

    const badRead = await call(
      env,
      `/api/v3/channels/${channelA2.channelId}/sites/example.com`,
      'GET',
      null,
      null,
      { 'X-CK-Read-Token': 'bad-read-token' }
    );
    assert.equal(badRead.status, 403);

    const queryTokenRead = await call(
      env,
      `/api/v3/channels/${channelA2.channelId}/sites/example.com?readToken=${channelA2.readToken}`,
      'GET'
    );
    assert.equal(queryTokenRead.status, 403);

    const hostileKdfEnvelope = createEnvelope('demo.com');
    hostileKdfEnvelope.kdf.i = 1000000000;
    const hostileKdf = await call(
      env,
      `/api/v3/channels/${channelA2.channelId}/sites/demo.com`,
      'PUT',
      hostileKdfEnvelope,
      null,
      writeHeaders(ownerA, channelA2)
    );
    assert.equal(hostileKdf.status, 400);
  }

  // owner hourly create quota: 30/day
  {
    const ownerC = await bootstrapOwner(env);
    for (let i = 0; i < 30; i += 1) {
      const ok = await call(env, '/api/v3/channels', 'POST', null, null, ownerHeaders(ownerC));
      assert.equal(ok.status, 200);
    }
    const limited = await call(env, '/api/v3/channels', 'POST', null, null, ownerHeaders(ownerC));
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get('Retry-After'));
  }

  // concurrent writes must retain every site in the coordinated index
  {
    const ownerD = await bootstrapOwner(env);
    const channelD = await createChannel(env, ownerD);
    const siteIds = ['a.example', 'b.example'];

    const pushes = await Promise.all(siteIds.map((siteId) => call(
      env,
      `/api/v3/channels/${channelD.channelId}/sites/${siteId}`,
      'PUT',
      createEnvelope(siteId),
      null,
      writeHeaders(ownerD, channelD)
    )));
    assert.deepEqual(pushes.map((response) => response.status), [200, 200]);

    const list = await call(env, '/api/v3/owners/sites', 'GET', null, null, ownerHeaders(ownerD));
    const payload = await readJson(list);
    assert.deepEqual(payload.sites.map((site) => site.siteId).sort(), siteIds);
  }

  // concurrent channel creation must still enforce the 30/day owner quota
  {
    const ownerE = await bootstrapOwner(env);
    const creates = await Promise.all(Array.from({ length: 31 }, () => call(
      env,
      '/api/v3/channels',
      'POST',
      null,
      null,
      ownerHeaders(ownerE)
    )));
    const statuses = creates.map((response) => response.status);
    assert.equal(statuses.filter((status) => status === 200).length, 30);
    assert.equal(statuses.filter((status) => status === 429).length, 1);
  }

  // clear owner active records
  {
    const clear = await call(env, '/api/v3/owners/sites', 'DELETE', null, null, ownerHeaders(ownerA));
    assert.equal(clear.status, 200);

    const listA = await call(env, '/api/v3/owners/sites', 'GET', null, null, ownerHeaders(ownerA));
    const payloadA = await readJson(listA);
    assert.equal(payloadA.sites.length, 0);
  }

  // existing KV metadata must migrate lazily when the coordinator is enabled
  {
    const legacyEnv = {
      COOKIE_STORE: new MemoryKV(),
      ALLOW_UNCOORDINATED_FOR_TESTS: true
    };
    const legacyOwner = await bootstrapOwner(legacyEnv);
    const legacyChannel = await createChannel(legacyEnv, legacyOwner);

    legacyEnv.COORDINATOR = new MemoryCoordinatorNamespace(() => legacyEnv);
    delete legacyEnv.ALLOW_UNCOORDINATED_FOR_TESTS;
    const authorized = await call(
      legacyEnv,
      `/api/v3/channels/${legacyChannel.channelId}/sites/legacy.example`,
      'PUT',
      createEnvelope('legacy.example'),
      null,
      writeHeaders(legacyOwner, legacyChannel)
    );
    assert.equal(authorized.status, 200);
  }

  console.log('Worker contract tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
