import type { Session } from '../types';
import {
  parseRemoteThread,
  type RemoteThread,
} from '../protocol/remoteHostV1';
import {
  deviceCredentialStore,
  type DeviceCredentialStore,
} from '../security/deviceCredentialStore';
import {
  RemoteHostError,
  requestRemoteJson,
  type RemoteJsonRequest,
} from './remoteHttp';

export interface MobileWorkspace {
  id: string;
  name: string;
  isDefault: boolean;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

// Compatibility name for existing Workspace UI imports. This is the same
// Mobile-safe projection and intentionally has no Desktop rootPath field.
export type ChatWorkspace = MobileWorkspace;

export interface WorkspaceThreadPage {
  items: Session[];
  total: number;
  nextCursor: string | null;
  limit: number;
}

export interface WorkspaceThreadQuery {
  status?: 'active' | 'archived';
  limit?: number;
  cursor?: string | null;
}

type JsonTransport = <T>(request: RemoteJsonRequest<T>) => Promise<T>;
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

const remoteThreadToSession = (thread: RemoteThread): Session => ({
  id: thread.id,
  title: thread.title,
  updatedAt: new Date(thread.updatedAt),
  workspaceId: thread.workspaceId,
  knowledgeBaseId: thread.knowledgeBaseId,
  roleId: thread.roleId,
  agentEnabled: thread.agentEnabled,
  status: thread.status,
});

export const parseMobileWorkspace = (value: unknown): MobileWorkspace => {
  if (!isRecord(value)) {
    throw new Error('workspace must be an object');
  }
  if ('rootPath' in value) {
    throw new Error('workspace must not expose rootPath to Mobile');
  }
  if (typeof value.isDefault !== 'boolean') {
    throw new Error('workspace.isDefault must be a boolean');
  }

  const status = requiredString(value, 'status', 'workspace');
  if (status !== 'active' && status !== 'archived') {
    throw new Error(`workspace.status is not supported: ${status}`);
  }

  return {
    id: requiredString(value, 'id', 'workspace'),
    name: requiredString(value, 'name', 'workspace'),
    isDefault: value.isDefault,
    status,
    createdAt: requiredString(value, 'createdAt', 'workspace'),
    updatedAt: requiredString(value, 'updatedAt', 'workspace'),
  };
};

const parseWorkspaceList = (value: unknown): MobileWorkspace[] => {
  if (!Array.isArray(value)) {
    throw new Error('workspaces must be an array');
  }
  return value.map(parseMobileWorkspace);
};

const parseNonNegativeInteger = (
  value: unknown,
  context: string,
): number => {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${context} must be a non-negative integer`);
  }
  return value as number;
};

const parsePageLimit = (value: unknown): number => {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 100) {
    throw new Error('workspaceThreadPage.limit must be an integer between 1 and 100');
  }
  return value as number;
};

const parseWorkspaceThreadPage = (
  value: unknown,
  workspaceId: string,
): WorkspaceThreadPage => {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error('workspaceThreadPage must contain an items array');
  }

  const remoteItems = value.items.map(parseRemoteThread);
  const mismatched = remoteItems.find(
    (thread: RemoteThread) => thread.workspaceId !== workspaceId,
  );
  if (mismatched) {
    throw new Error(
      `workspaceThreadPage returned thread ${mismatched.id} outside workspace ${workspaceId}`,
    );
  }

  const nextCursor = value.nextCursor;
  if (nextCursor !== null && typeof nextCursor !== 'string') {
    throw new Error('workspaceThreadPage.nextCursor must be a string or null');
  }

  return {
    items: remoteItems.map(remoteThreadToSession),
    total: parseNonNegativeInteger(value.total, 'workspaceThreadPage.total'),
    nextCursor,
    limit: parsePageLimit(value.limit),
  };
};

/**
 * Read-only Mobile client for the Desktop-provided Workspace projections.
 * Product semantics still come from Desktop ChatWorkspace and RemoteThread;
 * this client only owns the paired-device transport and Mobile-safe parsing.
 */
export class WorkspaceApiClient {
  constructor(
    private readonly credentialStore: DeviceCredentialStore = deviceCredentialStore,
    private readonly directTransport: JsonTransport = requestRemoteJson,
  ) {}

  async listChatWorkspaces(): Promise<MobileWorkspace[]> {
    return this.requestRead('/remote/v1/workspaces', parseWorkspaceList);
  }

  async listWorkspaceThreads(
    workspaceId: string,
    query: WorkspaceThreadQuery = {},
  ): Promise<WorkspaceThreadPage> {
    const normalizedWorkspaceId = workspaceId.trim();
    if (!normalizedWorkspaceId) {
      throw new RemoteHostError(
        'WORKSPACE_ID_REQUIRED',
        'A workspace id is required for reading project conversations',
      );
    }

    const status = query.status ?? 'active';
    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RemoteHostError(
        'INVALID_WORKSPACE_THREAD_LIMIT',
        'Workspace thread limit must be an integer between 1 and 100',
      );
    }

    const params = [`status=${status}`, `limit=${limit}`];
    if (query.cursor !== null && query.cursor !== undefined) {
      params.push(`cursor=${encodeURIComponent(query.cursor)}`);
    }

    const path = `/remote/v1/workspaces/${encodeURIComponent(
      normalizedWorkspaceId,
    )}/threads?${params.join('&')}`;

    return this.requestRead(path, value =>
      parseWorkspaceThreadPage(value, normalizedWorkspaceId),
    );
  }

  private async requestRead<T>(
    path: string,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const credential = await this.credentialStore.load();
    if (!credential) {
      throw new RemoteHostError(
        'PAIRING_REQUIRED',
        'This mobile device is not paired with Mira Desktop',
      );
    }

    const makeRequest = (hostUrl: string, allowInsecureDevelopment: boolean) => ({
      hostUrl,
      path,
      credential: credential.credential,
      allowInsecureDevelopment,
      parse,
    });

    if (credential.hostUrl) {
      return this.directTransport(makeRequest(credential.hostUrl, __DEV__));
    }

    throw new RemoteHostError(
      'REMOTE_ENDPOINT_UNAVAILABLE',
      'No Mira Desktop endpoint is available for reading project data',
    );
  }
}

export const workspaceApi = new WorkspaceApiClient();
