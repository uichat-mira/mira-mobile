'use strict';

const http = require('node:http');

const DEFAULT_PORT = 8787;
const DEVICE_ID = 'device-e2e-android';
const DEVICE_CREDENTIAL = 'mira_device_e2e_android.secret';
const CLAIM_ID = 'claim-e2e-1';
const POLL_TOKEN = 'poll-e2e-1';
const FIXTURE_THREAD_ID = 'thread-e2e-1';
const CREATED_THREAD_ID = 'thread-e2e-created';
const FIXED_TIME = '2026-10-04T04:00:00.000Z';
const SCOPES = [
  'threads:read',
  'messages:read',
  'messages:write',
  'agent:read',
  'agent:approve',
  'agent:control',
  'tools:read',
  'tools:invoke',
  'tools:approve',
  'tools:control',
  'artifacts:read',
  'memory:read',
  'memory:write',
];

const fixtureThread = {
  id: FIXTURE_THREAD_ID,
  title: 'MOB-059 Fixture Thread',
  modelName: 'fixture-model',
  workspaceId: null,
  knowledgeBaseId: null,
  roleId: null,
  agentEnabled: false,
  status: 'active',
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
  messageCount: 2,
  lastMessage: 'Fixture assistant reply',
};

const fixtureMessages = [
  {
    id: 'message-e2e-user',
    threadId: FIXTURE_THREAD_ID,
    role: 'user',
    content: 'Fixture hello from Host',
    parts: [{ type: 'text', text: 'Fixture hello from Host' }],
    createdAt: FIXED_TIME,
  },
  {
    id: 'message-e2e-assistant',
    threadId: FIXTURE_THREAD_ID,
    role: 'assistant',
    content: 'Fixture assistant reply',
    parts: [{ type: 'text', text: 'Fixture assistant reply' }],
    createdAt: FIXED_TIME,
  },
];

const envelope = data => ({
  success: true,
  data,
  timestamp: FIXED_TIME,
});

const errorEnvelope = (status, code, message) => ({
  status,
  payload: {
    success: false,
    code,
    message,
    errors: [],
    timestamp: FIXED_TIME,
  },
});

function createFixtureState() {
  return {
    credentialDelivered: false,
    createdThread: null,
  };
}

function manifest() {
  return {
    protocolVersion: 1,
    device: {
      id: DEVICE_ID,
      name: 'MOB-059 Android Fixture',
      platform: 'android',
      scopes: SCOPES,
    },
    routes: {
      threads: ['GET /threads', 'GET /threads/:id', 'POST /threads'],
      messages: ['GET /threads/:id/messages', 'POST /proxy/chat/default'],
      agent: [],
      tools: [],
      artifacts: [],
      memory: [],
    },
    reconnect: {
      mode: 'canonical-state-replay',
      eventCursor: false,
    },
    serverTime: FIXED_TIME,
  };
}

function isAuthorized(headers) {
  const value = headers.authorization ?? headers.Authorization;
  return value === `Bearer ${DEVICE_CREDENTIAL}`;
}

function threadForId(state, id) {
  if (id === FIXTURE_THREAD_ID) return fixtureThread;
  if (state.createdThread?.id === id) return state.createdThread;
  return null;
}

function messagesForId(state, id) {
  if (id === FIXTURE_THREAD_ID) return fixtureMessages;
  if (state.createdThread?.id === id) return [];
  return null;
}

function handleFixtureRequest({ method, url, headers = {}, body }, state) {
  const parsed = new URL(url, 'https://fixture.invalid');
  const path = parsed.pathname;

  if (method === 'GET' && path === '/health') {
    return {
      status: 200,
      payload: {
        ok: true,
        service: 'mira-mobile-e2e-fixture',
      },
    };
  }

  if (method === 'POST' && path === '/remote/pairing/claim') {
    if (
      body?.challengeId !== 'mob-059' ||
      body?.code !== 'ABCD2345' ||
      body?.transport !== 'direct'
    ) {
      return errorEnvelope(400, 'PAIRING_INPUT_INVALID', 'Unexpected fixture pairing request');
    }
    return {
      status: 200,
      payload: envelope({
        claimId: CLAIM_ID,
        pollToken: POLL_TOKEN,
        status: 'claimed',
        expiresAt: '2026-10-04T05:00:00.000Z',
      }),
    };
  }

  if (
    method === 'POST' &&
    path === `/remote/pairing/claims/${CLAIM_ID}/poll`
  ) {
    if (body?.pollToken !== POLL_TOKEN) {
      return errorEnvelope(403, 'PAIRING_POLL_DENIED', 'Unexpected fixture poll token');
    }

    if (state.credentialDelivered) {
      return {
        status: 200,
        payload: envelope({
          status: 'delivered',
          expiresAt: '2026-10-04T05:00:00.000Z',
          deviceId: DEVICE_ID,
          scopes: SCOPES,
        }),
      };
    }

    state.credentialDelivered = true;
    return {
      status: 200,
      payload: envelope({
        status: 'approved',
        expiresAt: '2026-10-04T05:00:00.000Z',
        deviceId: DEVICE_ID,
        scopes: SCOPES,
        credential: DEVICE_CREDENTIAL,
      }),
    };
  }

  if (!isAuthorized(headers)) {
    return errorEnvelope(401, 'REMOTE_CREDENTIAL_REQUIRED', 'Fixture credential required');
  }

  if (method === 'GET' && path === '/remote/v1/manifest') {
    return { status: 200, payload: envelope(manifest()) };
  }

  if (method === 'GET' && path === '/threads') {
    const threads = [
      fixtureThread,
      ...(state.createdThread ? [state.createdThread] : []),
    ];
    return { status: 200, payload: envelope(threads) };
  }

  if (method === 'POST' && path === '/threads') {
    if (!state.createdThread) {
      state.createdThread = {
        ...fixtureThread,
        id: CREATED_THREAD_ID,
        title: 'MOB-059 Created Thread',
        messageCount: 0,
        lastMessage: undefined,
      };
    }
    return { status: 200, payload: envelope(state.createdThread) };
  }

  const messageMatch = path.match(/^\/threads\/([^/]+)\/messages$/u);
  if (method === 'GET' && messageMatch) {
    const messages = messagesForId(state, decodeURIComponent(messageMatch[1]));
    if (messages === null) {
      return errorEnvelope(404, 'THREAD_NOT_FOUND', 'Fixture thread not found');
    }
    return { status: 200, payload: envelope(messages) };
  }

  const threadMatch = path.match(/^\/threads\/([^/]+)$/u);
  if (method === 'GET' && threadMatch) {
    const thread = threadForId(state, decodeURIComponent(threadMatch[1]));
    if (!thread) {
      return errorEnvelope(404, 'THREAD_NOT_FOUND', 'Fixture thread not found');
    }
    return { status: 200, payload: envelope(thread) };
  }

  return errorEnvelope(404, 'FIXTURE_ROUTE_NOT_FOUND', `No fixture route for ${method} ${path}`);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Fixture request body exceeded 1 MiB'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function startServer(port = Number(process.env.MIRA_E2E_HOST_PORT || DEFAULT_PORT)) {
  const state = createFixtureState();
  const server = http.createServer(async (req, res) => {
    try {
      const body = await readJsonBody(req);
      const result = handleFixtureRequest(
        {
          method: req.method ?? 'GET',
          url: req.url ?? '/',
          headers: req.headers,
          body,
        },
        state,
      );
      res.statusCode = result.status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(result.payload));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          success: false,
          code: 'FIXTURE_INTERNAL_ERROR',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`MOB-059 fixture listening on 0.0.0.0:${port}\n`);
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  CLAIM_ID,
  CREATED_THREAD_ID,
  DEVICE_CREDENTIAL,
  DEVICE_ID,
  FIXTURE_THREAD_ID,
  SCOPES,
  createFixtureState,
  handleFixtureRequest,
  manifest,
  startServer,
};
