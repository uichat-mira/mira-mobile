'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BASE_THREAD_ID,
  CHALLENGE_ID,
  CREATED_THREAD_TITLE,
  DEVICE_CREDENTIAL,
  DEVICE_ID,
  PAIRING_CODE,
  createFixtureServer,
} = require('./host-fixture.cjs');

const request = async (baseUrl, path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, options);
  const payload = await response.json();
  return { response, payload };
};

test('deterministic Host fixture follows pairing, manifest, thread and create contracts', async (t) => {
  const fixture = createFixtureServer({ port: 0, logger: () => undefined });
  const address = await fixture.listen();
  t.after(() => fixture.close());

  assert.equal(typeof address, 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const health = await request(baseUrl, '/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.status, 'ok');

  const meta = await request(baseUrl, '/app/meta');
  assert.equal(meta.payload.success, true);
  assert.match(meta.payload.data.displayName, /Mira/u);

  const claim = await request(baseUrl, '/remote/pairing/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challengeId: CHALLENGE_ID,
      code: PAIRING_CODE,
      deviceName: 'Mira Mobile (android)',
      platform: 'android',
      transport: 'direct',
      requestedScopes: ['threads:read', 'messages:read', 'messages:write'],
    }),
  });
  assert.equal(claim.payload.success, true);
  assert.equal(claim.payload.data.status, 'claimed');

  const poll = await request(
    baseUrl,
    `/remote/pairing/claims/${encodeURIComponent(claim.payload.data.claimId)}/poll`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pollToken: claim.payload.data.pollToken }),
    },
  );
  assert.equal(poll.payload.data.status, 'approved');
  assert.equal(poll.payload.data.deviceId, DEVICE_ID);
  assert.equal(poll.payload.data.credential, DEVICE_CREDENTIAL);

  const auth = { authorization: `Bearer ${DEVICE_CREDENTIAL}` };
  const manifest = await request(baseUrl, '/remote/v1/manifest', { headers: auth });
  assert.equal(manifest.payload.data.protocolVersion, 1);
  assert.equal(manifest.payload.data.device.id, DEVICE_ID);
  assert.ok(manifest.payload.data.device.scopes.includes('messages:write'));
  assert.ok(manifest.payload.data.routes.threads.includes('POST /threads'));

  const threads = await request(
    baseUrl,
    '/threads?status=active&sortBy=updatedAt&sortOrder=desc',
    { headers: auth },
  );
  assert.equal(threads.payload.data[0].id, BASE_THREAD_ID);
  assert.equal(threads.payload.data[0].title, 'E2E Fixture Thread');

  const messages = await request(baseUrl, `/threads/${BASE_THREAD_ID}/messages`, { headers: auth });
  assert.equal(messages.payload.data[0].content, 'Fixture assistant message');

  const created = await request(baseUrl, '/threads', {
    method: 'POST',
    headers: {
      ...auth,
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  assert.equal(created.payload.data.title, CREATED_THREAD_TITLE);

  const createdMessages = await request(
    baseUrl,
    `/threads/${created.payload.data.id}/messages`,
    { headers: auth },
  );
  assert.deepEqual(createdMessages.payload.data, []);
});

test('fixture rejects canonical Host routes without the paired device credential', async (t) => {
  const fixture = createFixtureServer({ port: 0, logger: () => undefined });
  const address = await fixture.listen();
  t.after(() => fixture.close());

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const result = await request(baseUrl, '/threads');
  assert.equal(result.response.status, 401);
  assert.equal(result.payload.code, 'REMOTE_DEVICE_UNAUTHORIZED');
});
