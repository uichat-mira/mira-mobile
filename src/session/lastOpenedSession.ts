import { localKeyValueStore, type LocalKeyValueStore } from '../storage/localKeyValueStore';
import type { SessionSource } from '../types';

export interface LastOpenedSession {
  sessionId: string;
  title: string;
  source: SessionSource;
  providerName: string | null;
  providerModel: string | null;
}

export interface LastOpenedSessionInput {
  sessionId: string;
  title?: string;
  source?: SessionSource;
  providerName?: string | null;
  providerModel?: string | null;
}

const LAST_OPENED_SESSION_KEY = 'mira.mobile.last-opened-session.v1';

export async function saveLastOpenedSession(
  input: LastOpenedSessionInput,
  store: LocalKeyValueStore = localKeyValueStore,
): Promise<void> {
  const sessionId = input.sessionId.trim();
  if (!sessionId) return;

  const source: SessionSource =
    input.source ?? (sessionId.startsWith('local-') ? 'local-provider' : 'remote-host');
  const record: LastOpenedSession = {
    sessionId,
    title: input.title?.trim() || '会话',
    source,
    providerName: input.providerName ?? null,
    providerModel: input.providerModel ?? null,
  };
  await store.set(LAST_OPENED_SESSION_KEY, JSON.stringify(record));
}

export async function loadLastOpenedSession(
  store: LocalKeyValueStore = localKeyValueStore,
): Promise<LastOpenedSession | null> {
  try {
    const raw = await store.get(LAST_OPENED_SESSION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;

    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.sessionId !== 'string' || candidate.sessionId.trim().length === 0) {
      return null;
    }
    return {
      sessionId: candidate.sessionId,
      title: typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title : '会话',
      source: candidate.source === 'local-provider' ? 'local-provider' : 'remote-host',
      providerName: typeof candidate.providerName === 'string' ? candidate.providerName : null,
      providerModel: typeof candidate.providerModel === 'string' ? candidate.providerModel : null,
    };
  } catch {
    return null;
  }
}

export async function removeLastOpenedSessions(
  sessionIds: readonly string[],
  store: LocalKeyValueStore = localKeyValueStore,
): Promise<LastOpenedSession | null> {
  const ids = new Set(sessionIds.filter((sessionId) => sessionId.trim().length > 0));
  if (ids.size === 0) return null;

  const record = await loadLastOpenedSession(store);
  if (!record || !ids.has(record.sessionId)) return null;

  await store.remove(LAST_OPENED_SESSION_KEY);
  return record;
}

export async function removeLastOpenedSession(
  sessionId: string,
  store: LocalKeyValueStore = localKeyValueStore,
): Promise<void> {
  await removeLastOpenedSessions([sessionId], store);
}
