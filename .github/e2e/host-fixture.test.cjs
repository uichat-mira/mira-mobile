'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CREATED_THREAD_ID,
  DEVICE_CREDENTIAL,
  DEVICE_ID,
  FIXTURE_THREAD_ID,
  createFixtureState,
  handleFixtureRequest,
} = require('./host-fixture.cjs');

const request = (state, method, url, body, authorized = false) =>
  handleFixtureRequest(
    {
      method,
      url,
      body,
      headers: authorized
        ? { authorization: `Bearer ${DEVICE_CREDENTIAL}` }
        : {},
    },
    state,
  );

test('fixture implements direct pairing claim and one-time credential delivery', () => {
  const state = createFixtureState();
  const claim = request(state, 'POST', '/remote/pairing/claim', {
    challengeId: 'mob-059',
    code: 'ABCD2345',
    transport: 'direct',
  });
  assert.equal(claim.status, 200);
  assert.equal(claim.payload.success, true);
  assert.equal(claim.payload.data.status, 'claimed');

  const approved = request(
    state,
    'POST',
    '/remote/pairing/claims/claim-e2e-1/poll',
    { pollToken: 'poll-e2e-1' },
  );
  assert.equal(approved.payload.data.status, 'approved');
  assert.equal(approved.payload.data.deviceId, DEVICE_ID);
  assert.equal(approved.payload.data.credential, DEVICE_CREDENTIAL);

  const delivered = request(
    state,
    'POST',
    '/remote/pairing/claims/claim-e2e-1/poll',
    { pollToken: 'poll-e2e-1' },
  );
  assert.equal(delivered.payload.data.status, 'delivered');
  assert.equal(delivered.payload.data.credential, undefined);
});

test('fixture requires the paired credential for canonical Host routes', () => {
  const state = createFixtureState();
  const denied = request(state, 'GET', '/remote/v1/manifest');
  assert.equal(denied.status, 401);

  const manifest = request(
    state,
    'GET',
    '/remote/v1/manifest',
    undefined,
    true,
  );
  assert.equal(manifest.status, 200);
  assert.equal(manifest.payload.data.device.id, DEVICE_ID);
  assert.ok(manifest.payload.data.routes.threads.includes('POST /threads'));
});

test('fixture exposes deterministic list, thread, messages, and create-thread capability', () => {
  const state = createFixtureState();

  const initial = request(state, 'GET', '/threads?status=active', undefined, true);
  assert.deepEqual(initial.payload.data.map(thread => thread.id), [FIXTURE_THREAD_ID]);

  const messages = request(
    state,
    'GET',
    `/threads/${FIXTURE_THREAD_ID}/messages`,
    undefined,
    true,
  );
  assert.equal(messages.payload.data[0].content, 'Fixture hello from Host');

  const created = request(state, 'POST', '/threads', {}, true);
  assert.equal(created.payload.data.id, CREATED_THREAD_ID);
  assert.equal(created.payload.data.title, 'MOB-059 Created Thread');

  const afterCreate = request(state, 'GET', '/threads', undefined, true);
  assert.deepEqual(
    afterCreate.payload.data.map(thread => thread.id),
    [FIXTURE_THREAD_ID, CREATED_THREAD_ID],
  );
});
