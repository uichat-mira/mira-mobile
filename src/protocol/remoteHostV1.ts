export const REMOTE_DEVICE_SCOPES = [
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
] as const;

export type RemoteDeviceScope = (typeof REMOTE_DEVICE_SCOPES)[number];

export interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
  message?: string;
  timestamp?: string;
}

export interface ApiErrorEnvelope {
  success: false;
  message: string;
  code?: string | number;
  errors?: unknown[];
  timestamp?: string;
}

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

export interface PairingDescriptor {
  version: 1;
  hostUrl: string;
  challengeId: string;
  code: string;
}

export interface PairingClaimRequest {
  challengeId: string;
  code: string;
  deviceName: string;
  platform: string;
  transport?: 'relay' | 'direct';
  publicKey?: string;
  requestedScopes?: RemoteDeviceScope[];
}

export interface PairingClaimResponse {
  claimId: string;
  pollToken: string;
  status: 'claimed';
  expiresAt: string;
}

export type PairingStatus =
  | 'pending'
  | 'claimed'
  | 'approved'
  | 'rejected'
  | 'delivered'
  | 'expired';

export interface PairingPollResponse {
  status: PairingStatus;
  expiresAt: string;
  deviceId: string | null;
  scopes: RemoteDeviceScope[];
  credential?: string;
}

export interface RemoteManifest {
  protocolVersion: 1;
  device: {
    id: string;
    name: string;
    platform: string;
    scopes: RemoteDeviceScope[];
  };
  routes: {
    threads: string[];
    messages: string[];
    agent: string[];
    tools: string[];
    artifacts: string[];
  };
  reconnect: {
    mode: 'canonical-state-replay';
    eventCursor: false;
  };
  serverTime: string;
}

export type RemoteThreadStatus = 'active' | 'archived' | 'deleted';

export interface RemoteThread {
  id: string;
  title: string;
  modelName: string | null;
  workspaceId: string | null;
  knowledgeBaseId: string | null;
  roleId: string | null;
  agentEnabled: boolean | null;
  status: RemoteThreadStatus | string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage?: string;
}

export type RemoteMessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type RemoteMessagePart =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      image: string;
      filename?: string;
      fileId?: string;
      mediaType?: string;
    }
  | {
      type: 'file';
      data: string;
      filename: string;
      fileId?: string;
      mimeType: string;
    }
  | { type: 'data'; name: string; value: unknown };

export interface RemoteMessage {
  id: string;
  threadId: string;
  role: RemoteMessageRole;
  content: string;
  parts: RemoteMessagePart[];
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export type RemoteAgentRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'waiting_user'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled';

export interface RemoteAgentRun {
  id: string;
  threadId: string;
  userId: number;
  status: RemoteAgentRunStatus;
  traceId: string;
  pendingApproval?: {
    id: string;
    runId: string;
    stepId: string;
    toolId: string;
    toolCallId?: string;
    reason: string;
    input?: Record<string, unknown>;
    inputHash?: string;
    createdAt: string;
  };
  blockedReason?: string;
  terminalReason?: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const MODEL_SAFE_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

export interface RemoteToolManifest {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  destructive: boolean;
  requiresApproval: boolean;
}

export type RemoteToolInvocationStatus =
  | 'completed'
  | 'awaiting_approval'
  | 'failed'
  | 'cancelled';

export interface RemoteToolInvocationProjection {
  invocationId: string;
  toolId: string;
  status: RemoteToolInvocationStatus;
  content?: string;
  approval?: { message: string; scope?: string };
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
    suggestedAction?: string | null;
  };
}

export type RemoteToolGatewayStreamEvent =
  | { type: 'tool:start'; invocationId: string; toolId: string }
  | { type: 'tool:progress'; invocationId: string; message: string }
  | {
      type: 'tool:approval_required';
      invocationId: string;
      message: string;
      scope?: string;
    }
  | { type: 'tool:error'; code: string; message: string }
  | { type: 'tool:complete'; invocation: RemoteToolInvocationProjection };
export type RemoteChatStreamEvent =
  | { type: 'start'; messageId?: string }
  | { type: 'start-step' }
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'data-tool-event'; data: Record<string, unknown> }
  | { type: 'data-execution-node'; data: Record<string, unknown> }
  | { type: 'data-rag-node'; data: Record<string, unknown> }
  | { type: 'finish-step' }
  | { type: 'finish'; finishReason: 'stop' | 'error' | string }
  | { type: 'error'; errorText: string }
  | { type: string; [key: string]: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requiredString = (
  record: Record<string, unknown>,
  key: string,
  context: string,
): string => {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${context}.${key} must be a non-empty string`);
  }
  return value;
};

const nullableString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const optionalBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

const parseScopes = (value: unknown): RemoteDeviceScope[] => {
  if (!Array.isArray(value)) {
    throw new Error('scopes must be an array');
  }

  const allowed = new Set<string>(REMOTE_DEVICE_SCOPES);
  return value.map((scope) => {
    if (typeof scope !== 'string' || !allowed.has(scope)) {
      throw new Error(`Unsupported remote-device scope: ${String(scope)}`);
    }
    return scope as RemoteDeviceScope;
  });
};

export const normalizeHostUrl = (
  value: string,
  options: { allowInsecureDevelopment?: boolean } = {},
): string => {
  const trimmed = value.trim().replace(/\/+$/, '');
  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Mira Host address is not a valid URL');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Mira Host URL must not contain embedded credentials');
  }

  const allowHttp = options.allowInsecureDevelopment === true;
  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    throw new Error('Mira Host must use HTTPS');
  }

  if (!parsed.hostname) {
    throw new Error('Mira Host URL must include a hostname');
  }

  return parsed.toString().replace(/\/+$/, '');
};

export const parsePairingUri = (value: string): PairingDescriptor => {
  const trimmed = value.trim();
  if (!/^mira:\/\/pair(?:\?|$)/u.test(trimmed)) {
    throw new Error('Pairing link must start with mira://pair');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Pairing link is not a valid URI');
  }

  const version = Number(parsed.searchParams.get('version'));
  if (version !== 1) {
    throw new Error(`Unsupported Mira pairing protocol version: ${String(version)}`);
  }

  const host = parsed.searchParams.get('host') ?? '';
  const challengeId = parsed.searchParams.get('challenge')?.trim() ?? '';
  const code = parsed.searchParams.get('code')?.trim().toUpperCase() ?? '';

  if (!challengeId || !code) {
    throw new Error('Pairing link is missing challenge or code');
  }

  return {
    version: 1,
    hostUrl: normalizeHostUrl(host, { allowInsecureDevelopment: __DEV__ }),
    challengeId,
    code,
  };
};

export const unwrapApiEnvelope = <T>(
  value: unknown,
  parseData: (data: unknown) => T,
): T => {
  if (!isRecord(value) || typeof value.success !== 'boolean') {
    throw new Error('Mira Host returned an invalid response envelope');
  }

  if (value.success !== true) {
    const message =
      typeof value.message === 'string' && value.message.trim()
        ? value.message
        : 'Mira Host request failed';
    const error = new Error(message) as Error & {
      code?: string | number;
      details?: unknown;
    };
    if (typeof value.code === 'string' || typeof value.code === 'number') {
      error.code = value.code;
    }
    error.details = value.errors;
    throw error;
  }

  return parseData(value.data);
};

export const parsePairingClaimResponse = (value: unknown): PairingClaimResponse => {
  if (!isRecord(value)) {
    throw new Error('Pairing claim response must be an object');
  }

  const status = requiredString(value, 'status', 'pairingClaim');
  if (status !== 'claimed') {
    throw new Error(`Unexpected pairing claim status: ${status}`);
  }

  return {
    claimId: requiredString(value, 'claimId', 'pairingClaim'),
    pollToken: requiredString(value, 'pollToken', 'pairingClaim'),
    status: 'claimed',
    expiresAt: requiredString(value, 'expiresAt', 'pairingClaim'),
  };
};

export const parsePairingPollResponse = (value: unknown): PairingPollResponse => {
  if (!isRecord(value)) {
    throw new Error('Pairing poll response must be an object');
  }

  const status = requiredString(value, 'status', 'pairingPoll') as PairingStatus;
  const allowedStatuses = new Set<PairingStatus>([
    'pending',
    'claimed',
    'approved',
    'rejected',
    'delivered',
    'expired',
  ]);
  if (!allowedStatuses.has(status)) {
    throw new Error(`Unexpected pairing poll status: ${status}`);
  }

  return {
    status,
    expiresAt: requiredString(value, 'expiresAt', 'pairingPoll'),
    deviceId: nullableString(value.deviceId),
    scopes: parseScopes(value.scopes),
    ...(typeof value.credential === 'string' && value.credential
      ? { credential: value.credential }
      : {}),
  };
};

const stringArray = (value: unknown, context: string): string[] => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${context} must be a string array`);
  }
  return value;
};

export const parseRemoteManifest = (value: unknown): RemoteManifest => {
  if (!isRecord(value)) {
    throw new Error('Remote manifest must be an object');
  }
  if (value.protocolVersion !== 1) {
    throw new Error(`Unsupported Host protocol version: ${String(value.protocolVersion)}`);
  }
  if (!isRecord(value.device) || !isRecord(value.routes) || !isRecord(value.reconnect)) {
    throw new Error('Remote manifest is missing device, routes, or reconnect');
  }
  if (value.reconnect.mode !== 'canonical-state-replay' || value.reconnect.eventCursor !== false) {
    throw new Error('Remote manifest reconnect contract is not supported by this client');
  }

  return {
    protocolVersion: 1,
    device: {
      id: requiredString(value.device, 'id', 'manifest.device'),
      name: requiredString(value.device, 'name', 'manifest.device'),
      platform: requiredString(value.device, 'platform', 'manifest.device'),
      scopes: parseScopes(value.device.scopes),
    },
    routes: {
      threads: stringArray(value.routes.threads, 'manifest.routes.threads'),
      messages: stringArray(value.routes.messages, 'manifest.routes.messages'),
      agent: stringArray(value.routes.agent, 'manifest.routes.agent'),
      tools:
        typeof value.routes.tools === 'undefined'
          ? []
          : stringArray(value.routes.tools, 'manifest.routes.tools'),
      artifacts: stringArray(value.routes.artifacts, 'manifest.routes.artifacts'),
    },
    reconnect: {
      mode: 'canonical-state-replay',
      eventCursor: false,
    },
    serverTime: requiredString(value, 'serverTime', 'manifest'),
  };
};

export const parseRemoteToolManifest = (value: unknown): RemoteToolManifest => {
  if (!isRecord(value)) throw new Error('Remote tool manifest must be an object');
  if (!isRecord(value.parameters)) {
    throw new Error('Remote tool manifest parameters must be an object');
  }
  if (typeof value.destructive !== 'boolean' || typeof value.requiresApproval !== 'boolean') {
    throw new Error('Remote tool manifest capability flags must be booleans');
  }
  const name = requiredString(value, 'name', 'remoteTool');
  if (!MODEL_SAFE_TOOL_NAME_PATTERN.test(name)) {
    throw new Error('Remote tool name must match ^[A-Za-z0-9_-]{1,64}$');
  }
  return {
    id: requiredString(value, 'id', 'remoteTool'),
    name,
    description: requiredString(value, 'description', 'remoteTool'),
    parameters: value.parameters,
    destructive: value.destructive,
    requiresApproval: value.requiresApproval,
  };
};

export const parseRemoteToolInvocationProjection = (
  value: unknown,
): RemoteToolInvocationProjection => {
  if (!isRecord(value)) throw new Error('Remote tool invocation must be an object');
  const status = requiredString(value, 'status', 'remoteToolInvocation') as RemoteToolInvocationStatus;
  if (!['completed', 'awaiting_approval', 'failed', 'cancelled'].includes(status)) {
    throw new Error('Unsupported remote tool invocation status: ' + status);
  }
  const approval = isRecord(value.approval)
    ? {
        message: requiredString(value.approval, 'message', 'remoteToolInvocation.approval'),
        ...(typeof value.approval.scope === 'string' && value.approval.scope
          ? { scope: value.approval.scope }
          : {}),
      }
    : undefined;
  const error = isRecord(value.error)
    ? {
        code: requiredString(value.error, 'code', 'remoteToolInvocation.error'),
        message: requiredString(value.error, 'message', 'remoteToolInvocation.error'),
        ...(typeof value.error.retryable === 'boolean' ? { retryable: value.error.retryable } : {}),
        ...(typeof value.error.suggestedAction === 'string' || value.error.suggestedAction === null
          ? { suggestedAction: value.error.suggestedAction }
          : {}),
      }
    : undefined;
  return {
    invocationId: requiredString(value, 'invocationId', 'remoteToolInvocation'),
    toolId: requiredString(value, 'toolId', 'remoteToolInvocation'),
    status,
    ...(typeof value.content === 'string' ? { content: value.content } : {}),
    ...(approval ? { approval } : {}),
    ...(error ? { error } : {}),
  };
};

export const parseRemoteToolGatewayStreamEvent = (
  value: unknown,
): RemoteToolGatewayStreamEvent => {
  if (!isRecord(value)) throw new Error('Remote tool stream event must be an object');
  const type = requiredString(value, 'type', 'remoteToolEvent');
  if (type === 'tool:start') {
    return { type, invocationId: requiredString(value, 'invocationId', 'remoteToolEvent'), toolId: requiredString(value, 'toolId', 'remoteToolEvent') };
  }
  if (type === 'tool:progress') {
    return { type, invocationId: requiredString(value, 'invocationId', 'remoteToolEvent'), message: requiredString(value, 'message', 'remoteToolEvent') };
  }
  if (type === 'tool:approval_required') {
    return { type, invocationId: requiredString(value, 'invocationId', 'remoteToolEvent'), message: requiredString(value, 'message', 'remoteToolEvent'), ...(typeof value.scope === 'string' && value.scope ? { scope: value.scope } : {}) };
  }
  if (type === 'tool:error') {
    return { type, code: requiredString(value, 'code', 'remoteToolEvent'), message: requiredString(value, 'message', 'remoteToolEvent') };
  }
  if (type === 'tool:complete') {
    return { type, invocation: parseRemoteToolInvocationProjection(value.invocation) };
  }
  throw new Error('Unsupported remote tool stream event: ' + type);
};
export const parseRemoteThread = (value: unknown): RemoteThread => {
  if (!isRecord(value)) {
    throw new Error('Thread must be an object');
  }

  return {
    id: requiredString(value, 'id', 'thread'),
    title: requiredString(value, 'title', 'thread'),
    modelName: nullableString(value.modelName),
    workspaceId: nullableString(value.workspaceId),
    knowledgeBaseId: nullableString(value.knowledgeBaseId),
    roleId: nullableString(value.roleId),
    agentEnabled: optionalBoolean(value.agentEnabled),
    status: requiredString(value, 'status', 'thread'),
    createdAt: requiredString(value, 'createdAt', 'thread'),
    updatedAt: requiredString(value, 'updatedAt', 'thread'),
    messageCount:
      typeof value.messageCount === 'number' && Number.isFinite(value.messageCount)
        ? value.messageCount
        : 0,
    ...(typeof value.lastMessage === 'string' ? { lastMessage: value.lastMessage } : {}),
  };
};

const parseRemoteMessagePart = (value: unknown): RemoteMessagePart | null => {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }

  if (value.type === 'text') {
    return { type: 'text', text: requiredString(value, 'text', 'message.part') };
  }
  if (value.type === 'image') {
    return {
      type: 'image',
      image: requiredString(value, 'image', 'message.part'),
      ...(typeof value.filename === 'string' ? { filename: value.filename } : {}),
      ...(typeof value.fileId === 'string' ? { fileId: value.fileId } : {}),
      ...(typeof value.mediaType === 'string' ? { mediaType: value.mediaType } : {}),
    };
  }
  if (value.type === 'file') {
    return {
      type: 'file',
      data: requiredString(value, 'data', 'message.part'),
      filename: requiredString(value, 'filename', 'message.part'),
      ...(typeof value.fileId === 'string' ? { fileId: value.fileId } : {}),
      mimeType: requiredString(value, 'mimeType', 'message.part'),
    };
  }
  if (value.type === 'data') {
    return {
      type: 'data',
      name: requiredString(value, 'name', 'message.part'),
      value: value.value,
    };
  }

  return null;
};

export const parseRemoteMessage = (value: unknown): RemoteMessage => {
  if (!isRecord(value)) {
    throw new Error('Message must be an object');
  }
  const role = requiredString(value, 'role', 'message') as RemoteMessageRole;
  if (!['user', 'assistant', 'system', 'tool'].includes(role)) {
    throw new Error(`Unsupported message role: ${role}`);
  }

  const parts = Array.isArray(value.parts)
    ? value.parts
        .map(parseRemoteMessagePart)
        .filter((part): part is RemoteMessagePart => part !== null)
    : [];

  return {
    id: requiredString(value, 'id', 'message'),
    threadId: requiredString(value, 'threadId', 'message'),
    role,
    content: typeof value.content === 'string' ? value.content : '',
    parts,
    ...(isRecord(value.metadata) ? { metadata: value.metadata } : {}),
    createdAt: requiredString(value, 'createdAt', 'message'),
  };
};

export const parseRemoteAgentRun = (value: unknown): RemoteAgentRun => {
  if (!isRecord(value)) {
    throw new Error('Agent run must be an object');
  }

  return {
    ...value,
    id: requiredString(value, 'id', 'agentRun'),
    threadId: requiredString(value, 'threadId', 'agentRun'),
    userId: typeof value.userId === 'number' ? value.userId : 0,
    status: requiredString(value, 'status', 'agentRun') as RemoteAgentRunStatus,
    traceId: requiredString(value, 'traceId', 'agentRun'),
    createdAt: requiredString(value, 'createdAt', 'agentRun'),
    updatedAt: requiredString(value, 'updatedAt', 'agentRun'),
  };
};

export const parseRemoteChatStreamEvent = (value: unknown): RemoteChatStreamEvent => {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error('Chat stream event must contain a type');
  }

  if (value.type === 'text-delta' && typeof value.delta !== 'string') {
    throw new Error('text-delta event must contain delta text');
  }
  if (value.type === 'error' && typeof value.errorText !== 'string') {
    throw new Error('error event must contain errorText');
  }

  return value as RemoteChatStreamEvent;
};