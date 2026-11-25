import {
  openCloudRelayPostSse,
  requestCloudRelayJson,
} from '../api/cloudRelay';
import { requestRemoteJson, RemoteHostError } from '../api/remoteHttp';
import { remoteMiraHostClient } from '../api/remoteMiraHost';
import { CloudToolHostClient } from '../tools/cloudToolHostClient';
import {
  cloudRelayEntry,
  type CloudRelayAccess,
  type CloudRelayEntry,
} from '../cloud/cloudRelayEntry';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import { useDesktopConnectionStore } from '../connectivity/desktopConnectionAuthority';
import {
  parseRemoteManifest,
  type RemoteManifest,
  type RemoteToolInvocationProjection,
} from '../protocol/remoteHostV1';
import {
  deviceCredentialStore,
  type StoredDeviceCredential,
} from '../security/deviceCredentialStore';
import {
  ToolApprovalRequiredError,
  ToolGatewayError,
  type ToolCallRequest,
  type ToolCallResult,
  type ToolGatewayClient,
} from '../tools/toolGatewayClient';
import {
  McpProtocolClient,
  McpProtocolError,
  type McpResourceContent,
} from './mcpProtocolClient';
import {
  projectMcpService,
  type McpServiceProjection,
} from './mcpServiceCapabilities';
import type {
  McpServiceDiscovery,
  McpServiceSnapshot,
} from './mcpServiceBinding';
import {
  desktopThreadWorkspaceService,
  DesktopThreadWorkspaceError,
  type DesktopThreadWorkspaceService,
} from './desktopThreadWorkspace';
import { REMOTE_THREAD_CONTEXT_HEADER } from '../protocol/remoteThreadWorkspaceV1';

export const DESKTOP_MCP_SERVICE_ID = 'mira-desktop';
export const DESKTOP_MCP_RESOURCE_URI =
  'mira://service/mira-desktop/capabilities';

const DESKTOP_MCP_ENDPOINT = 'https://mira-desktop.invalid/mcp';
const MAX_THREAD_ID_LENGTH = 256;

const normalizeThreadId = (threadId: string | undefined): string | undefined => {
  if (threadId === undefined) return undefined;
  const normalized = threadId.trim();
  const hasControlCharacter = Array.from(normalized).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
  if (
    normalized.length === 0 ||
    normalized.length > MAX_THREAD_ID_LENGTH ||
    hasControlCharacter
  ) {
    throw new McpProtocolError(
      'rejected',
      'The Local conversation thread context is invalid',
      'THREAD_CONTEXT_INVALID',
    );
  }
  return normalized;
};
const CAPABILITIES_MIME = 'application/json';
const DESKTOP_REQUIRED_SCOPES = ['tools:read', 'tools:invoke'] as const;
const DESKTOP_ALLOWED_ACCESS = [
  'read',
  'write',
  'send',
  'destructive',
] as const;

type DesktopRpcFetch = typeof fetch;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const requestPayload = (init?: RequestInit): Record<string, unknown> => {
  if (typeof init?.body !== 'string') {
    throw new McpProtocolError(
      'invalid_response',
      'Desktop MCP request body is missing',
      'DESKTOP_MCP_REQUEST_INVALID',
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(init.body) as unknown;
  } catch {
    throw new McpProtocolError(
      'invalid_response',
      'Desktop MCP request body is invalid JSON',
      'DESKTOP_MCP_REQUEST_INVALID',
    );
  }
  if (!isRecord(value)) {
    throw new McpProtocolError(
      'invalid_response',
      'Desktop MCP request body is not an object',
      'DESKTOP_MCP_REQUEST_INVALID',
    );
  }
  return value;
};

const asResponse = (payload: unknown, notification: boolean): Response =>
  new Response(notification ? null : JSON.stringify(payload), {
    status: notification ? 202 : 200,
    headers: notification
      ? undefined
      : { 'content-type': 'application/json' },
  });

const errorResponse = (error: unknown): Response | null => {
  if (!(error instanceof RemoteHostError) || error.status === undefined) {
    return null;
  }
  return new Response(
    JSON.stringify({ error: error.code, message: error.message }),
    {
      status: error.status,
      headers: { 'content-type': 'application/json' },
    },
  );
};

const isNotification = (payload: Record<string, unknown>): boolean =>
  !Object.hasOwn(payload, 'id');

const assertDesktopMode = (
  mode: 'direct' | 'cloud',
  generation: number,
): void => {
  const current = useDesktopConnectionStore.getState();
  if (
    current.mode !== mode ||
    current.generation !== generation ||
    current.transitioning
  ) {
    throw new McpProtocolError(
      'unauthorized',
      'The active Desktop connection changed',
      'DESKTOP_MCP_BINDING_CHANGED',
    );
  }
};

type DirectCredentialStore = Pick<typeof deviceCredentialStore, 'load'>;

const currentDirectCredential = async (
  generation: number,
  expected?: Pick<StoredDeviceCredential, 'deviceId' | 'hostUrl'>,
  store: DirectCredentialStore = deviceCredentialStore,
): Promise<StoredDeviceCredential> => {
  assertDesktopMode('direct', generation);
  const credential = await store.load();
  if (!credential) {
    throw new McpProtocolError(
      'unauthorized',
      'The paired Desktop credential is unavailable',
      'DESKTOP_MCP_DIRECT_CREDENTIAL_MISSING',
    );
  }
  if (
    expected &&
    (credential.deviceId !== expected.deviceId ||
      credential.hostUrl !== expected.hostUrl)
  ) {
    throw new McpProtocolError(
      'unauthorized',
      'The paired Desktop changed',
      'DESKTOP_MCP_BINDING_CHANGED',
    );
  }
  assertDesktopMode('direct', generation);
  return credential;
};

const createDirectFetch = (
  generation: number,
  expected: Pick<StoredDeviceCredential, 'deviceId' | 'hostUrl'>,
  store: DirectCredentialStore,
  request: typeof requestRemoteJson,
): DesktopRpcFetch =>
  (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const payload = requestPayload(init);
    try {
      const credential = await currentDirectCredential(
        generation,
        expected,
        store,
      );
      const result = await request({
        hostUrl: credential.hostUrl,
        path: '/mcp',
        method: 'POST',
        credential: credential.credential,
        body: payload,
        signal: init?.signal ?? undefined,
        raw: true,
        parse: value => value,
      });
      await currentDirectCredential(generation, expected, store);
      return asResponse(result, isNotification(payload));
    } catch (error) {
      const response = errorResponse(error);
      if (response) return response;
      throw error;
    }
  }) as typeof fetch;

const assertCloudBinding = (
  access: CloudRelayAccess,
  accountId: string,
  hostId: string,
  generation: number,
  entry: Pick<CloudRelayEntry, 'assertCurrentAccess'>,
): void => {
  assertDesktopMode('cloud', generation);
  const cloud = useCloudAccountStore.getState();
  if (
    cloud.status !== 'signed_in' ||
    cloud.account?.id !== accountId ||
    access.accountId !== accountId ||
    access.target.hostId !== hostId
  ) {
    throw new McpProtocolError(
      'unauthorized',
      'The authorized Cloud Desktop changed',
      'DESKTOP_MCP_BINDING_CHANGED',
    );
  }
  entry.assertCurrentAccess(access);
};

const createCloudFetch = (
  access: CloudRelayAccess,
  accountId: string,
  hostId: string,
  generation: number,
  entry: Pick<CloudRelayEntry, 'assertCurrentAccess'>,
  json: typeof requestCloudRelayJson,
  threadId: string | undefined,
): DesktopRpcFetch =>
  (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const payload = requestPayload(init);
    try {
      assertCloudBinding(access, accountId, hostId, generation, entry);
      // Remote Thread Workspace V1 accepts the header only for official Cloud
      // MCP tool execution; discovery and other MCP services must not see it.
      const headers = threadId && payload.method === 'tools/call'
        ? { [REMOTE_THREAD_CONTEXT_HEADER]: threadId }
        : undefined;
      const result = await json(access.target, access.tickets, {
        hostUrl: access.target.endpoint,
        path: '/mcp',
        method: 'POST',
        body: payload,
        ...(headers ? { headers } : {}),
        signal: init?.signal ?? undefined,
        raw: true,
        parse: value => value,
        allowInsecureDevelopment: false,
      });
      assertCloudBinding(access, accountId, hostId, generation, entry);
      return asResponse(result, isNotification(payload));
    } catch (error) {
      const response = errorResponse(error);
      if (response) return response;
      throw error;
    }
  }) as typeof fetch;

const readCapabilityResource = async (
  client: McpProtocolClient,
  signal?: AbortSignal,
): Promise<unknown> => {
  let resources;
  try {
    resources = await client.listResources(signal);
  } catch (error) {
    if (
      error instanceof McpProtocolError &&
      (error.kind === 'rejected' || error.kind === 'unsupported')
    ) {
      return undefined;
    }
    throw error;
  }
  const descriptor = resources.find(
    entry => entry.uri === DESKTOP_MCP_RESOURCE_URI,
  );
  if (!descriptor) return undefined;
  let contents: McpResourceContent[];
  try {
    contents = await client.readResource(descriptor.uri, signal);
  } catch (error) {
    if (
      error instanceof McpProtocolError &&
      (error.kind === 'rejected' || error.kind === 'unsupported')
    ) {
      return undefined;
    }
    throw error;
  }
  const content = contents.find(entry => entry.uri === descriptor.uri);
  if (!content) return undefined;
  const mime = (content.mimeType ?? descriptor.mimeType ?? '').toLowerCase();
  if (mime !== CAPABILITIES_MIME) return { unsupportedMimeType: mime };
  try {
    return JSON.parse(content.text) as unknown;
  } catch {
    return { unparsable: true };
  }
};

const parseDesktopResult = (
  value: unknown,
): RemoteToolInvocationProjection => {
  if (!isRecord(value) || !isRecord(value.structuredContent)) {
    throw new ToolGatewayError(
      'DESKTOP_MCP_RESULT_INVALID',
      'Mira Desktop returned an invalid tool result',
    );
  }
  const structured = value.structuredContent;
  if (
    typeof structured.invocationId !== 'string' ||
    typeof structured.toolId !== 'string' ||
    !['completed', 'awaiting_approval', 'failed', 'cancelled'].includes(
      String(structured.status),
    )
  ) {
    throw new ToolGatewayError(
      'DESKTOP_MCP_RESULT_INVALID',
      'Mira Desktop returned an incomplete tool result',
    );
  }
  const content = Array.isArray(value.content)
    ? value.content
        .filter(
          (block): block is { type: string; text: string } =>
            isRecord(block) &&
            block.type === 'text' &&
            typeof block.text === 'string',
        )
        .map(block => block.text)
        .join('')
    : '';
  const approval = isRecord(structured.approval) &&
    typeof structured.approval.message === 'string'
    ? {
        message: structured.approval.message,
        ...(typeof structured.approval.scope === 'string'
          ? { scope: structured.approval.scope }
          : {}),
      }
    : undefined;
  const error = isRecord(structured.error) &&
    typeof structured.error.code === 'string' &&
    typeof structured.error.message === 'string'
    ? {
        code: structured.error.code,
        message: structured.error.message,
        ...(typeof structured.error.retryable === 'boolean'
          ? { retryable: structured.error.retryable }
          : {}),
        ...(structured.error.suggestedAction === null ||
        typeof structured.error.suggestedAction === 'string'
          ? { suggestedAction: structured.error.suggestedAction as string | null }
          : {}),
      }
    : undefined;
  return {
    invocationId: structured.invocationId,
    toolId: structured.toolId,
    status: structured.status as RemoteToolInvocationProjection['status'],
    ...(content ? { content } : {}),
    ...(approval ? { approval } : {}),
    ...(error ? { error } : {}),
  };
};

const projectCompletion = (
  invocation: RemoteToolInvocationProjection,
  request: Pick<ToolCallRequest, 'callId' | 'name' | 'arguments'>,
): ToolCallResult => {
  if (invocation.status === 'completed') {
    return { content: invocation.content ?? '' };
  }
  if (invocation.status === 'awaiting_approval') {
    throw new ToolApprovalRequiredError({
      invocationId: invocation.invocationId,
      callId: request.callId,
      name: request.name,
      arguments: request.arguments,
      message:
        invocation.approval?.message ??
        'Mira Desktop requires approval for this action',
      ...(invocation.approval?.scope
        ? { scope: invocation.approval.scope }
        : {}),
    });
  }
  throw new ToolGatewayError(
    invocation.error?.code ?? `TOOL_${invocation.status.toUpperCase()}`,
    invocation.error?.message ??
      (invocation.status === 'cancelled'
        ? 'Desktop tool invocation was cancelled'
        : 'Desktop tool invocation failed'),
    invocation.error?.retryable,
    invocation.error?.suggestedAction,
  );
};

const createDesktopExecutionGateway = (
  client: McpProtocolClient,
  resolveApproval: (input: {
    invocationId: string;
    decision: 'approved' | 'rejected';
    toolId: string;
    args: Record<string, unknown>;
    signal?: AbortSignal;
  }) => Promise<RemoteToolInvocationProjection>,
  threadBinding?: {
    assertCompatible: () => void | Promise<void>;
    remember: () => void | Promise<void>;
  },
): ToolGatewayClient => {
  const invocationTools = new Map<string, string>();
  const rememberWorkspaceExecution = async (): Promise<void> => {
    if (!threadBinding) return;
    try {
      await threadBinding.remember();
    } catch (error) {
      // No side-effecting call may start without a durable routing identity.
      if (error instanceof DesktopThreadWorkspaceError) {
        throw new ToolGatewayError(error.code, error.message);
      }
      throw new ToolGatewayError('THREAD_BINDING_STORAGE_FAILED', 'Unable to persist the remote thread binding');
    }
  };
  return {
    listTools: async () => [],
    callTool: async (request, options) => {
      let args: unknown;
      try {
        args = JSON.parse(request.arguments || '{}') as unknown;
      } catch {
        throw new ToolGatewayError(
          'TOOL_ARGUMENTS_INVALID',
          'Tool arguments are not valid JSON',
        );
      }
      if (!isRecord(args)) {
        throw new ToolGatewayError(
          'TOOL_ARGUMENTS_INVALID',
          'Tool arguments must be a JSON object',
        );
      }
      if (threadBinding) {
        try {
          await threadBinding.assertCompatible();
        } catch (error) {
          if (error instanceof DesktopThreadWorkspaceError) {
            throw new ToolGatewayError(error.code, error.message);
          }
          throw error;
        }
        // Bind before the side-effecting call. If Desktop creates the workspace
        // and the response is lost, Mobile must still be able to locate and end
        // exactly this thread later. A non-workspace call records only routing
        // identity; Desktop still reports `not_started` and creates no directory.
        await rememberWorkspaceExecution();
      }
      const result = parseDesktopResult(
        await client.callTool(request.name, args, options?.signal),
      );
      invocationTools.set(result.invocationId, result.toolId);
      return projectCompletion(result, request);
    },
    resolveApproval: async (approval, decision, options) => {
      const toolId = invocationTools.get(approval.invocationId);
      if (!toolId) {
        throw new ToolGatewayError(
          'TOOL_APPROVAL_STALE',
          'The Desktop approval no longer belongs to this run',
        );
      }
      let args: unknown;
      try {
        args = JSON.parse(approval.arguments || '{}') as unknown;
      } catch {
        throw new ToolGatewayError(
          'TOOL_ARGUMENTS_INVALID',
          'Tool arguments are not valid JSON',
        );
      }
      if (!isRecord(args)) {
        throw new ToolGatewayError(
          'TOOL_ARGUMENTS_INVALID',
          'Tool arguments must be a JSON object',
        );
      }
      // An allowed approval is the point where Desktop may create the private
      // workspace. Record it before the side-effecting request so an uncertain
      // Relay response still leaves a retryable thread binding.
      if (decision === 'approved') {
        await rememberWorkspaceExecution();
      }
      const invocation = await resolveApproval({
        invocationId: approval.invocationId,
        decision,
        toolId,
        args,
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      if (decision === 'rejected' && invocation.status === 'cancelled') {
        invocationTools.delete(approval.invocationId);
        return { status: 'rejected' };
      }
      const result = projectCompletion(invocation, approval);
      if (invocation.status === 'completed') {
        invocationTools.delete(approval.invocationId);
      }
      return { status: 'completed', result };
    },
  };
};

const projectDesktop = async (input: {
  client: McpProtocolClient;
  grantedScopes: readonly string[];
  bindingKey: string;
  assertCurrent: () => void | Promise<void>;
  resolveApproval: Parameters<typeof createDesktopExecutionGateway>[1];
  threadBinding?: Parameters<typeof createDesktopExecutionGateway>[2];
  signal?: AbortSignal;
}): Promise<McpServiceSnapshot> => {
  const serverInfo = await input.client.initialize(input.signal);
  if (serverInfo.serverName !== DESKTOP_MCP_SERVICE_ID) {
    throw new McpProtocolError(
      'invalid_response',
      'The selected Host is not a Mira Desktop MCP service',
      'DESKTOP_MCP_IDENTITY_MISMATCH',
    );
  }
  const descriptors = await input.client.listTools(input.signal);
  const capabilityResource = serverInfo.resources
    ? await readCapabilityResource(input.client, input.signal)
    : undefined;
  const projection: McpServiceProjection = projectMcpService({
    serviceId: DESKTOP_MCP_SERVICE_ID,
    serviceName: 'Mira Desktop',
    serviceDescription:
      '当前活动的 Mira Desktop Host；工具通过标准 MCP 暴露，实际执行仍由 Desktop Harness 与审批链决定。',
    toolDescriptors: descriptors,
    capabilityResource,
    grantedScopes: input.grantedScopes,
    requiredScopes: DESKTOP_REQUIRED_SCOPES,
    permittedAccess: DESKTOP_ALLOWED_ACCESS,
    permittedToolNames: descriptors.map(tool => tool.name),
    serverInfo,
  });
  return {
    ...projection,
    bindingKey: input.bindingKey,
    initialToolNames: [],
    executionGateway: createDesktopExecutionGateway(
      input.client,
      input.resolveApproval,
      input.threadBinding,
    ),
    assertCurrent: input.assertCurrent,
  };
};

export const createDirectDesktopMcpDiscovery = (
  generation: number,
  deps: {
    credentialStore?: DirectCredentialStore;
    request?: typeof requestRemoteJson;
    approvalClient?: Pick<typeof remoteMiraHostClient, 'resolveToolApproval'>;
  } = {},
): McpServiceDiscovery => {
  const credentialStore = deps.credentialStore ?? deviceCredentialStore;
  const request = deps.request ?? requestRemoteJson;
  const approvalClient = deps.approvalClient ?? remoteMiraHostClient;
  return {
  serviceTypeId: DESKTOP_MCP_SERVICE_ID,
  async discover({ signal }) {
    const credential = await currentDirectCredential(
      generation,
      undefined,
      credentialStore,
    );
    const expected = {
      deviceId: credential.deviceId,
      hostUrl: credential.hostUrl,
    };
    const manifest: RemoteManifest = await request({
      hostUrl: credential.hostUrl,
      path: '/remote/v1/manifest',
      credential: credential.credential,
      signal,
      parse: parseRemoteManifest,
    });
    await currentDirectCredential(generation, expected, credentialStore);
    const client = new McpProtocolClient({
      endpoint: DESKTOP_MCP_ENDPOINT,
      token: 'desktop-direct-transport',
      fetchImpl: createDirectFetch(
        generation,
        expected,
        credentialStore,
        request,
      ),
    });
    return projectDesktop({
      client,
      grantedScopes: manifest.device.scopes,
      bindingKey: `direct:${expected.deviceId}:${expected.hostUrl}:${generation}`,
      assertCurrent: () =>
        currentDirectCredential(
          generation,
          expected,
          credentialStore,
        ).then(() => undefined),
      resolveApproval: input =>
        approvalClient.resolveToolApproval(input),
      ...(signal ? { signal } : {}),
    });
  },
  };
};

export const createCloudDesktopMcpDiscovery = (input: {
  accountId: string;
  hostId: string;
  generation: number;
  /** Local Provider conversation id; opaque to Desktop. */
  threadId?: string;
  entry?: Pick<CloudRelayEntry, 'discoverHost' | 'assertCurrentAccess'>;
  json?: typeof requestCloudRelayJson;
  sse?: typeof openCloudRelayPostSse;
  threadWorkspace?: Pick<
    DesktopThreadWorkspaceService,
    'assertBindingCompatible' | 'rememberBinding'
  >;
}): McpServiceDiscovery => ({
  serviceTypeId: DESKTOP_MCP_SERVICE_ID,
  async discover({ accountId, signal }) {
    if (accountId !== input.accountId) {
      throw new McpProtocolError(
        'unauthorized',
        'The Mira Cloud account changed before Desktop discovery',
        'DESKTOP_MCP_BINDING_CHANGED',
      );
    }
    const threadId = normalizeThreadId(input.threadId);
    const entry = input.entry ?? cloudRelayEntry;
    const json = input.json ?? requestCloudRelayJson;
    const access = await entry.discoverHost(input.hostId);
    assertCloudBinding(
      access,
      input.accountId,
      input.hostId,
      input.generation,
      entry,
    );
    const manifest = await json(access.target, access.tickets, {
      hostUrl: access.target.endpoint,
      path: '/remote/v1/manifest',
      signal,
      parse: parseRemoteManifest,
      allowInsecureDevelopment: false,
    });
    const client = new McpProtocolClient({
      endpoint: DESKTOP_MCP_ENDPOINT,
      token: 'desktop-cloud-transport',
      fetchImpl: createCloudFetch(
        access,
        input.accountId,
        input.hostId,
        input.generation,
        entry,
        json,
        threadId,
      ),
    });
    const threadWorkspace = threadId
      ? input.threadWorkspace ?? desktopThreadWorkspaceService
      : null;
    const threadIdentity = threadId && threadWorkspace
      ? {
          threadId,
          accountId: input.accountId,
          hostId: input.hostId,
          deviceId: manifest.device.id,
        }
      : null;
    const approvalClient = new CloudToolHostClient(
      input.accountId,
      input.hostId,
      entry,
      json,
      input.sse ?? openCloudRelayPostSse,
      changedAccountId => {
        const desktop = useDesktopConnectionStore.getState();
        const cloud = useCloudAccountStore.getState();
        return (
          desktop.mode === 'cloud' &&
          desktop.generation === input.generation &&
          !desktop.transitioning &&
          cloud.status === 'signed_in' &&
          cloud.account?.id === changedAccountId
        );
      },
      threadId,
    );
    return projectDesktop({
      client,
      grantedScopes: manifest.device.scopes,
      bindingKey:
        `cloud:${input.accountId}:${input.hostId}:${manifest.device.id}:${input.generation}`,
      assertCurrent: () =>
        assertCloudBinding(
          access,
          input.accountId,
          input.hostId,
          input.generation,
          entry,
        ),
      resolveApproval: approval =>
        approvalClient.resolveToolApproval(approval),
      ...(threadIdentity && threadWorkspace
        ? {
            threadBinding: {
              assertCompatible: () =>
                threadWorkspace.assertBindingCompatible(threadIdentity),
              remember: () =>
                threadWorkspace.rememberBinding({
                  ...threadIdentity,
                  generation: input.generation,
                }),
            },
          }
        : {}),
      ...(signal ? { signal } : {}),
    });
  },
});
