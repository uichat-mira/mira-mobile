import type { ChatMessage, Session } from '../types';
import { localKeyValueStore, type LocalKeyValueStore } from '../storage/localKeyValueStore';

interface StoredLocalSession {
  id: string;
  providerId: string;
  title: string;
  updatedAt: string;
  agentEnabled?: boolean;
  messages: Array<{
    id: string;
    role: ChatMessage['role'];
    content: string;
    timestamp: string;
  }>;
}

const STORAGE_KEY = 'mira.local-provider.sessions.v1';
const writeQueues = new WeakMap<LocalKeyValueStore, Promise<void>>();

export const DEFAULT_LOCAL_SESSION_TITLE = 'New local conversation';

const toSession = (value: StoredLocalSession): Session => ({
  id: value.id,
  title: value.title,
  updatedAt: new Date(value.updatedAt),
  source: 'local-provider',
  agentEnabled: value.agentEnabled === true,
  status: 'local',
});

const toMessage = (value: StoredLocalSession['messages'][number]): ChatMessage => ({
  id: value.id,
  role: value.role,
  content: value.content,
  timestamp: new Date(value.timestamp),
});

const parseStored = (value: unknown): StoredLocalSession => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored local session is invalid');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    typeof record.providerId !== 'string' ||
    typeof record.title !== 'string' ||
    typeof record.updatedAt !== 'string' ||
    !Array.isArray(record.messages)
  ) {
    throw new Error('Stored local session is incomplete');
  }
  const messages = record.messages.map((message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new Error('Stored local session message is invalid');
    }
    const item = message as Record<string, unknown>;
    if (
      typeof item.id !== 'string' ||
      !['user', 'assistant', 'system'].includes(String(item.role)) ||
      typeof item.content !== 'string' ||
      typeof item.timestamp !== 'string'
    ) {
      throw new Error('Stored local session message is incomplete');
    }
    return {
      id: item.id,
      role: item.role as ChatMessage['role'],
      content: item.content,
      timestamp: item.timestamp,
    };
  });
  return {
    id: record.id,
    providerId: record.providerId,
    title: record.title,
    updatedAt: record.updatedAt,
    agentEnabled: record.agentEnabled === true,
    messages,
  };
};

export class LocalSessionRepository {
  constructor(private readonly store: LocalKeyValueStore = localKeyValueStore) {}

  private async loadStored(): Promise<StoredLocalSession[]> {
    const value = await this.store.get(STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) throw new Error('Stored local sessions must be an array');
    return parsed.map(parseStored);
  }

  private async saveStored(values: readonly StoredLocalSession[]) {
    await this.store.set(STORAGE_KEY, JSON.stringify(values));
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const previous = writeQueues.get(this.store) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    writeQueues.set(this.store, result.then(() => undefined, () => undefined));
    return result;
  }

  async list(providerId?: string): Promise<Session[]> {
    const values = await this.loadStored();
    return values
      .filter((value) => !providerId || value.providerId === providerId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(toSession);
  }

  create(providerId: string, title = DEFAULT_LOCAL_SESSION_TITLE): Promise<Session> {
    return this.enqueueWrite(async () => {
      const values = await this.loadStored();
      const now = new Date().toISOString();
      const value: StoredLocalSession = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        providerId,
        title: title.trim() || DEFAULT_LOCAL_SESSION_TITLE,
        updatedAt: now,
        agentEnabled: false,
        messages: [],
      };
      await this.saveStored([value, ...values]);
      return toSession(value);
    });
  }

  rename(sessionId: string, title: string): Promise<void> {
    return this.enqueueWrite(async () => {
      const values = await this.loadStored();
      const index = values.findIndex((item) => item.id === sessionId);
      if (index < 0) throw new Error('Local session was not found');
      const nextTitle = title.trim();
      if (!nextTitle) return;
      values[index] = { ...values[index], title: nextTitle };
      await this.saveStored(values);
    });
  }

  async get(sessionId: string): Promise<Session> {
    const value = (await this.loadStored()).find((item) => item.id === sessionId);
    if (!value) throw new Error('Local session was not found');
    return toSession(value);
  }

  async getProviderId(sessionId: string): Promise<string> {
    const value = (await this.loadStored()).find((item) => item.id === sessionId);
    if (!value) throw new Error('Local session was not found');
    return value.providerId;
  }

  async getAgentEnabled(sessionId: string): Promise<boolean> {
    const value = (await this.loadStored()).find((item) => item.id === sessionId);
    if (!value) throw new Error('Local session was not found');
    return value.agentEnabled === true;
  }

  setAgentEnabled(sessionId: string, enabled: boolean): Promise<void> {
    return this.enqueueWrite(async () => {
      const values = await this.loadStored();
      const index = values.findIndex((item) => item.id === sessionId);
      if (index < 0) throw new Error('Local session was not found');
      values[index] = {
        ...values[index],
        agentEnabled: enabled,
      };
      await this.saveStored(values);
    });
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const value = (await this.loadStored()).find((item) => item.id === sessionId);
    if (!value) throw new Error('Local session was not found');
    return value.messages.map(toMessage);
  }

  appendMessages(sessionId: string, messages: readonly ChatMessage[]): Promise<void> {
    return this.enqueueWrite(async () => {
      const values = await this.loadStored();
      const index = values.findIndex((item) => item.id === sessionId);
      if (index < 0) throw new Error('Local session was not found');
      const current = values[index];
      const knownIds = new Set(current.messages.map((message) => message.id));
      const nextMessages = messages
        .filter((message) => !knownIds.has(message.id))
        .map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          timestamp: message.timestamp.toISOString(),
        }));
      if (nextMessages.length === 0) return;
      values[index] = {
        ...current,
        updatedAt: new Date().toISOString(),
        messages: [...current.messages, ...nextMessages],
      };
      await this.saveStored(values);
    });
  }

  delete(sessionId: string): Promise<void> {
    return this.enqueueWrite(async () => {
      const values = await this.loadStored();
      const index = values.findIndex((item) => item.id === sessionId);
      if (index < 0) throw new Error('Local session was not found');
      await this.saveStored([
        ...values.slice(0, index),
        ...values.slice(index + 1),
      ]);
    });
  }

  clear(): Promise<void> {
    return this.enqueueWrite(() => this.store.remove(STORAGE_KEY));
  }
}
