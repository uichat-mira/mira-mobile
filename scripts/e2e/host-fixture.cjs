'use strict';

const http = require('node:http');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const CHALLENGE_ID = 'e2e-challenge';
const PAIRING_CODE = 'ABCD2345';
const DEVICE_ID = 'device-e2e-1';
const DEVICE_CREDENTIAL = 'mira_device_e2e_fixture_credential';
const BASE_THREAD_ID = 'thread-e2e-1';
const CREATED_THREAD_TITLE = 'New E2E Conversation';

const ALL_SCOPES = [
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

const fixedThread = () => ({
  id: BASE_THREAD_ID,
  title: 'E2E Fixture Thread',
  modelName: 'fixture-model',
  workspaceId: null,
  knowledgeBaseId: null,
  roleId: null,
  agentEnabled: false,
  status: 'active',
  createdAt: '2026-10-04T00:00:00.000Z',
  updatedAt: '2026-10-04T00:01:00.000Z',
  messageCount: 1,
  lastMessage: 'Fixture assistant message',
});

const fixedMessages = () => [
  {
    id: 'message-e2e-1',
    threadId: BASE_THREAD_ID,
    role: 'assistant',
    content: 'Fixture assistant message',
    parts: [{ type: 'text', text: 'Fixture assistant message' }],
    createdAt: '2026-10-04T00:01:00.000Z',
  },
];

const envelope = (data) => ({
  success: true,
  data,
  timestamp: new Date().toISOString(),
});

const sendJson = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
};

const sendError = (res, status, code, message) => {
  sendJson(res, status, {
    success: false,
    code,
    message,
    errors: [],
    timestamp: new Date().toISOString(),
  });
};

const readJsonBody = async (req) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('request body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const createFixtureServer = ({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  logger = (line) => process.stdout.write(`${line}\n`),
} = {}) => {
  let claimCounter = 0;
  let createdThreadCounter = 0;
  const claims = new Map();
  const createdThreads = [];

  const log = (req, status) => {
    const url = new URL(req.url || '/', 'http://fixture.local');
    logger(JSON.stringify({
      at: new Date().toISOString(),
      method: req.method,
      path: url.pathname,
      status,
    }));
  };

  const requireCredential = (req, res) => {
    if (req.headers.authorization !== `Bearer ${DEVICE_CREDENTIAL}`) {
      sendError(res, 401, 'REMOTE_DEVICE_UNAUTHORIZED', 'Fixture device credential is required');
      log(req, 401);
      return false;
    }
    return true;
  };

  const server = http.createServer(async (req, res) => {
    const method = req.method || 'GET';
    const url = new URL(req.url || '/', 'http://fixture.local');
    const path = url.pathname;

    try {
      if (method === 'GET' && path === '/health') {
        sendJson(res, 200, { status: 'ok' });
        log(req, 200);
        return;
      }

      if (method === 'GET' && path === '/app/meta') {
        sendJson(res, 200, envelope({
          name: 'mira-host-e2e-fixture',
          displayName: 'Mira Host E2E Fixture',
          version: '1.0.0-e2e',
        }));
        log(req, 200);
        return;
      }

      if (method === 'POST' && path === '/remote/pairing/claim') {
        const body = await readJsonBody(req);
        if (
          body.challengeId !== CHALLENGE_ID ||
          String(body.code || '').toUpperCase() !== PAIRING_CODE
        ) {
          sendError(res, 400, 'PAIRING_REQUEST_INVALID', 'Fixture challenge or code is invalid');
          log(req, 400);
          return;
        }

        const requestedScopes = Array.isArray(body.requestedScopes)
          ? body.requestedScopes.filter((scope) => ALL_SCOPES.includes(scope))
          : [];
        const scopes = requestedScopes.length > 0 ? requestedScopes : [...ALL_SCOPES];
        const claimId = `claim-e2e-${++claimCounter}`;
        const pollToken = `poll-e2e-${claimCounter}`;
        claims.set(claimId, { pollToken, scopes, delivered: false });

        sendJson(res, 200, envelope({
          claimId,
          pollToken,
          status: 'claimed',
          expiresAt: '2099-01-01T00:00:00.000Z',
        }));
        log(req, 200);
        return;
      }

      const pollMatch = path.match(/^\/remote\/pairing\/claims\/([^/]+)\/poll$/u);
      if (method === 'POST' && pollMatch) {
        const claim = claims.get(decodeURIComponent(pollMatch[1]));
        const body = await readJsonBody(req);
        if (!claim || body.pollToken !== claim.pollToken) {
          sendError(res, 404, 'PAIRING_CLAIM_NOT_FOUND', 'Fixture pairing claim was not found');
          log(req, 404);
          return;
        }

        if (claim.delivered) {
          sendJson(res, 200, envelope({
            status: 'delivered',
            expiresAt: '2099-01-01T00:00:00.000Z',
            deviceId: DEVICE_ID,
            scopes: claim.scopes,
          }));
          log(req, 200);
          return;
        }

        claim.delivered = true;
        sendJson(res, 200, envelope({
          status: 'approved',
          expiresAt: '2099-01-01T00:00:00.000Z',
          deviceId: DEVICE_ID,
          scopes: claim.scopes,
          credential: DEVICE_CREDENTIAL,
        }));
        log(req, 200);
        return;
      }

      if (path.startsWith('/remote/v1/') || path.startsWith('/threads')) {
        if (!requireCredential(req, res)) return;
      }

      if (method === 'GET' && path === '/remote/v1/manifest') {
        sendJson(res, 200, envelope({
          protocolVersion: 1,
          device: {
            id: DEVICE_ID,
            name: 'Mira Android E2E',
            platform: 'android',
            scopes: [...ALL_SCOPES],
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
          serverTime: new Date().toISOString(),
        }));
        log(req, 200);
        return;
      }

      if (method === 'GET' && path === '/threads') {
        sendJson(res, 200, envelope([fixedThread(), ...createdThreads]));
        log(req, 200);
        return;
      }

      if (method === 'POST' && path === '/threads') {
        const body = await readJsonBody(req);
        const id = `thread-created-${++createdThreadCounter}`;
        const thread = {
          id,
          title: typeof body.title === 'string' && body.title.trim()
            ? body.title.trim()
            : CREATED_THREAD_TITLE,
          modelName: 'fixture-model',
          workspaceId: null,
          knowledgeBaseId: null,
          roleId: null,
          agentEnabled: false,
          status: 'active',
          createdAt: '2026-10-04T00:02:00.000Z',
          updatedAt: '2026-10-04T00:02:00.000Z',
          messageCount: 0,
        };
        createdThreads.unshift(thread);
        sendJson(res, 200, envelope(thread));
        log(req, 200);
        return;
      }

      const messagesMatch = path.match(/^\/threads\/([^/]+)\/messages$/u);
      if (method === 'GET' && messagesMatch) {
        const threadId = decodeURIComponent(messagesMatch[1]);
        if (threadId === BASE_THREAD_ID) {
          sendJson(res, 200, envelope(fixedMessages()));
          log(req, 200);
          return;
        }
        if (createdThreads.some((thread) => thread.id === threadId)) {
          sendJson(res, 200, envelope([]));
          log(req, 200);
          return;
        }
        sendError(res, 404, 'THREAD_NOT_FOUND', 'Fixture thread was not found');
        log(req, 404);
        return;
      }

      const threadMatch = path.match(/^\/threads\/([^/]+)$/u);
      if (method === 'GET' && threadMatch) {
        const threadId = decodeURIComponent(threadMatch[1]);
        const thread = threadId === BASE_THREAD_ID
          ? fixedThread()
          : createdThreads.find((item) => item.id === threadId);
        if (!thread) {
          sendError(res, 404, 'THREAD_NOT_FOUND', 'Fixture thread was not found');
          log(req, 404);
          return;
        }
        sendJson(res, 200, envelope(thread));
        log(req, 200);
        return;
      }

      sendError(res, 404, 'FIXTURE_ROUTE_NOT_FOUND', `No fixture route for ${method} ${path}`);
      log(req, 404);
    } catch (error) {
      sendError(
        res,
        500,
        'FIXTURE_INTERNAL_ERROR',
        error instanceof Error ? error.message : 'Fixture request failed',
      );
      log(req, 500);
    }
  });

  return {
    server,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve(server.address());
      });
    }),
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
};

if (require.main === module) {
  const fixture = createFixtureServer({
    host: process.env.MIRA_E2E_FIXTURE_HOST || DEFAULT_HOST,
    port: Number(process.env.MIRA_E2E_FIXTURE_PORT || DEFAULT_PORT),
  });

  fixture.listen()
    .then((address) => {
      process.stdout.write(`Mira E2E Host fixture listening on ${JSON.stringify(address)}\n`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });

  const shutdown = () => {
    fixture.close()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = {
  ALL_SCOPES,
  BASE_THREAD_ID,
  CHALLENGE_ID,
  CREATED_THREAD_TITLE,
  DEVICE_CREDENTIAL,
  DEVICE_ID,
  PAIRING_CODE,
  createFixtureServer,
};
