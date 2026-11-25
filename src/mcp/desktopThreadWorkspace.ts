import {
  openCloudRelayPostSse,
  requestCloudRelayJson,
} from '../api/cloudRelay';
import { RemoteHostError } from '../api/remoteHttp';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import {
  cloudRelayEntry,
  type CloudRelayEntry,
} from '../cloud/cloudRelayEntry';
import type {
  RemoteThreadWorkspaceProjection,
} from '../protocol/remoteThreadWorkspaceV1';
import {
  localKeyValueStore,
  type LocalKeyValueStore,
} from '../storage/localKeyValueStore';
import { CloudToolHostClient } from '../tools/cloudToolHostClient';

/**
 * Mobile-side binding for one Local Provider thread that actually executed a
 * Mira Desktop tool. It records only trusted routing identity: the Cloud
 * account, Host, Desktop device and connection generation that produced the
 * workspace. It is not authority and creates no Desktop workspace.
 */
export interface DesktopThreadBinding {
  threadId: string;
  accountId: string;
  hostId: string;
  deviceId: string;
  generation: number;
  boundAt: string;
}

export const DESKTOP_THREAD_WORKSPACE_STORAGE_KEY =
  'mira.mobile.desktop-thread-workspaces.v1';

const MAX_BINDINGS = 256;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parseBinding = (value: unknown): DesktopThreadBinding | null => {
  if (!isRecord(value)) return null;
  const {
    threadId,
    accountId,
    hostId,
    deviceId,
    generation,
    boundAt,
  } = value;
  if (
    typeof threadId !== 'string' || threadId.length === 0 ||
    typeof accountId !== 'string' || accountId.length === 0 ||
    typeof hostId !== 'string' || hostId.length === 0 ||
    typeof deviceId !== 'string' || deviceId.length === 0 ||
    typeof generation !== 'number' || !Number.isInteger(generation) ||
    generation < 0 ||
    typeof boundAt !== 'string' || boundAt.length === 0
  ) {
    return null;
  }
  return { threadId, accountId, hostId, deviceId, generation, boundAt };
};

const parseBindings = (raw: string | null): DesktopThreadBinding[] => {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.bindings)) {
    return [];
  }
  return value.bindings
    .map(parseBinding)
    .filter((binding): binding is DesktopThreadBinding => binding !== null);
};

/**
 * Persisted locally only so a later explicit end can target the same Host even
 * after re-entering the conversation or restarting the app. No credential,
 * workspace path or file content is stored.
 */
export class DesktopThreadWorkspaceRepository {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly store: LocalKeyValueStore = localKeyValueStore) {}

  async get(threadId: string): Promise<DesktopThreadBinding | null> {
    await this.writeQueue.catch(() => undefined);
    const bindings = parseBindings(
      await this.store.get(DESKTOP_THREAD_WORKSPACE_STORAGE_KEY),
    );
    return bindings.find(binding => binding.threadId === threadId) ?? null;
  }

  async remember(binding: DesktopThreadBinding): Promise<void> {
    await this.enqueue(async () => {
      const existing = parseBindings(
        await this.store.get(DESKTOP_THREAD_WORKSPACE_STORAGE_KEY),
      );
      const next = [
        binding,
        ...existing.filter(item => item.threadId !== binding.threadId),
      ]
        .sort((left, right) => right.boundAt.localeCompare(left.boundAt))
        .slice(0, MAX_BINDINGS);
      await this.store.set(
        DESKTOP_THREAD_WORKSPACE_STORAGE_KEY,
        JSON.stringify({ version: 1, bindings: next }),
      );
    });
  }

  async forget(threadId: string): Promise<void> {
    await this.enqueue(async () => {
      const existing = parseBindings(
        await this.store.get(DESKTOP_THREAD_WORKSPACE_STORAGE_KEY),
      );
      const next = existing.filter(item => item.threadId !== threadId);
      if (next.length === existing.length) return;
      if (next.length === 0) {
        await this.store.remove(DESKTOP_THREAD_WORKSPACE_STORAGE_KEY);
        return;
      }
      await this.store.set(
        DESKTOP_THREAD_WORKSPACE_STORAGE_KEY,
        JSON.stringify({ version: 1, bindings: next }),
      );
    });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.writeQueue
      .catch(() => undefined)
      .then(operation);
    this.writeQueue = next;
    return next;
  }
}

export type DesktopThreadWorkspaceErrorCode =
  | 'THREAD_BINDING_CHANGED'
  | 'THREAD_WORKSPACE_UNAVAILABLE'
  | 'THREAD_END_NOT_CONFIRMED';

export class DesktopThreadWorkspaceError extends Error {
  constructor(
    readonly code: DesktopThreadWorkspaceErrorCode,
    message: string,
    readonly retryable = false,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DesktopThreadWorkspaceError';
  }
}

export type DesktopThreadEndResult =
  | { kind: 'no_remote_work'; threadId: string }
  | {
      kind: 'ended';
      threadId: string;
      projection: RemoteThreadWorkspaceProjection;
      /** False when the confirmed remote end could not be recorded locally. */
      localBindingCleared?: boolean;
    };

type ThreadWorkspaceClient = Pick<
  CloudToolHostClient,
  'getThreadWorkspace' | 'endThreadWorkspace'
>;

export interface DesktopThreadWorkspaceServiceOptions {
  repository?: DesktopThreadWorkspaceRepository;
  entry?: Pick<CloudRelayEntry, 'discoverHost' | 'assertCurrentAccess'>;
  json?: typeof requestCloudRelayJson;
  sse?: typeof openCloudRelayPostSse;
  makeClient?: (
    binding: DesktopThreadBinding,
  ) => ThreadWorkspaceClient;
  accountIsCurrent?: (accountId: string) => boolean;
}

const defaultAccountIsCurrent = (accountId: string): boolean => {
  const state = useCloudAccountStore.getState();
  if (state.account?.id !== accountId) return false;
  // A transient Cloud outage keeps the retained account; the actual Host call
  // still fails safely and remains retryable. Definite logout/revocation does
  // not authorize any more Cloud work.
  return (
    state.status !== 'signed_out' &&
    state.status !== 'session_rejected' &&
    state.status !== 'device_revoked'
  );
};

const TIMEOUT_CODES = new Set([
  'NETWORK_ERROR',
  'REQUEST_ABORTED',
  'CLOUD_RELAY_HOST_OFFLINE',
  'CLOUD_RELAY_HOST_NOT_FOUND',
  'RELAY_HOST_OFFLINE',
  'RELAY_DISCONNECTED',
  'RELAY_NETWORK_ERROR',
  'RELAY_CONNECT_TIMEOUT',
  'RELAY_HANDSHAKE_TIMEOUT',
  'CLOUD_RELAY_AUTH_UNAVAILABLE',
]);

const unconfirmedEnd = (
  error: unknown,
  message: string,
): DesktopThreadWorkspaceError => {
  const code = error instanceof RemoteHostError ? error.code : '';
  return new DesktopThreadWorkspaceError(
    'THREAD_END_NOT_CONFIRMED',
    message,
    TIMEOUT_CODES.has(code) ||
      code === 'thread_cleanup_incomplete' ||
      code === 'INVALID_RESPONSE' ||
      (error instanceof RemoteHostError && (error.status ?? 0) >= 500),
    error,
  );
};

/**
 * Reads and ends the Desktop workspace for one explicit Mobile thread.
 *
 * Every operation re-resolves the originally bound account/Host/device instead
 * of using whichever Desktop happens to be selected now. A Host switch or a
 * different Cloud account must not silently address another thread's work.
 */
export class DesktopThreadWorkspaceService {
  private readonly repository: DesktopThreadWorkspaceRepository;
  private readonly entry: Pick<
    CloudRelayEntry,
    'discoverHost' | 'assertCurrentAccess'
  >;
  private readonly json: typeof requestCloudRelayJson;
  private readonly sse: typeof openCloudRelayPostSse;
  private readonly makeClient: (
    binding: DesktopThreadBinding,
  ) => ThreadWorkspaceClient;
  private readonly accountIsCurrent: (accountId: string) => boolean;

  constructor(options: DesktopThreadWorkspaceServiceOptions = {}) {
    this.repository =
      options.repository ?? new DesktopThreadWorkspaceRepository();
    this.entry = options.entry ?? cloudRelayEntry;
    this.json = options.json ?? requestCloudRelayJson;
    this.sse = options.sse ?? openCloudRelayPostSse;
    this.accountIsCurrent = options.accountIsCurrent ?? defaultAccountIsCurrent;
    this.makeClient = options.makeClient ?? ((binding) =>
      new CloudToolHostClient(
        binding.accountId,
        binding.hostId,
        this.entry,
        this.json,
        this.sse,
        this.accountIsCurrent,
      ));
  }

  getBinding(threadId: string): Promise<DesktopThreadBinding | null> {
    return this.repository.get(threadId);
  }

  /**
   * Binds an executed call to its trusted routing identity. A real thread can
   * only stay on the account/Host/Desktop that created it.
   */
  async rememberBinding(input: {
    threadId: string;
    accountId: string;
    hostId: string;
    deviceId: string;
    generation: number;
  }): Promise<void> {
    const existing = await this.repository.get(input.threadId);
    if (existing) {
      if (
        existing.accountId !== input.accountId ||
        existing.hostId !== input.hostId ||
        existing.deviceId !== input.deviceId
      ) {
        throw new DesktopThreadWorkspaceError(
          'THREAD_BINDING_CHANGED',
          'This thread is already bound to another Mira Desktop Host',
        );
      }
      return;
    }
    await this.repository.remember({
      ...input,
      boundAt: new Date().toISOString(),
    });
  }

  async assertBindingCompatible(input: {
    threadId: string;
    accountId: string;
    hostId: string;
    deviceId: string;
  }): Promise<void> {
    const existing = await this.repository.get(input.threadId);
    if (!existing) return;
    if (
      existing.accountId !== input.accountId ||
      existing.hostId !== input.hostId ||
      existing.deviceId !== input.deviceId
    ) {
      throw new DesktopThreadWorkspaceError(
        'THREAD_BINDING_CHANGED',
        'This thread is already bound to another Mira Desktop Host',
      );
    }
  }

  async getWorkspace(
    threadId: string,
  ): Promise<RemoteThreadWorkspaceProjection> {
    const binding = await this.repository.get(threadId);
    if (!binding) {
      return {
        threadId,
        status: 'not_started',
        workspace: null,
        startedAt: null,
        endedAt: null,
      };
    }
    const client = this.makeClient(binding);
    try {
      return await client.getThreadWorkspace(threadId, binding.deviceId);
    } catch (error) {
      const retryable = error instanceof RemoteHostError
        ? TIMEOUT_CODES.has(error.code) ||
          (error.status ?? 0) >= 500 ||
          error.code === 'INVALID_RESPONSE'
        : false;
      throw new DesktopThreadWorkspaceError(
        'THREAD_WORKSPACE_UNAVAILABLE',
        'Unable to read the Mira Desktop workspace for this thread',
        retryable,
        error,
      );
    }
  }

  async endThread(threadId: string): Promise<DesktopThreadEndResult> {
    const binding = await this.repository.get(threadId);
    if (!binding) {
      // No executed Desktop call means no remote workspace was bound. Do not
      // invent a Host to notify.
      return { kind: 'no_remote_work', threadId };
    }
    const client = this.makeClient(binding);
    let projection: RemoteThreadWorkspaceProjection;
    try {
      projection = await client.endThreadWorkspace(threadId, binding.deviceId);
    } catch (error) {
      throw unconfirmedEnd(
        error,
        'Mira Desktop did not confirm that this remote thread ended',
      );
    }
    // Only a confirmed end response proves both the lifecycle and cleanup.
    // A discovery-style `ended` read is not enough. A local bookkeeping failure
    // must not downgrade the confirmed remote result.
    let localBindingCleared = true;
    try {
      await this.repository.forget(threadId);
    } catch {
      localBindingCleared = false;
    }
    return {
      kind: 'ended',
      threadId,
      projection,
      ...(localBindingCleared ? {} : { localBindingCleared: false }),
    };
  }

  async forget(threadId: string): Promise<void> {
    await this.repository.forget(threadId);
  }
}

export const desktopThreadWorkspaceService =
  new DesktopThreadWorkspaceService();
