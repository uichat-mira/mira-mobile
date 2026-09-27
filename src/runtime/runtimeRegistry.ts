import type { Session, SessionSource } from '../types';
import { LocalProviderRuntime } from './localProviderRuntime';
import { RemoteHostRuntime } from './remoteHostRuntime';
import type { ConversationRuntime } from './conversationRuntime';
import { remoteToolGatewayClient } from '../tools/remoteToolGatewayClient';

export type SessionSourceFilter = 'all' | SessionSource;

export class RuntimeRegistry {
  readonly remote: RemoteHostRuntime;
  readonly local: LocalProviderRuntime;

  constructor(
    local = new LocalProviderRuntime({ toolGateway: remoteToolGatewayClient }),
    remote = new RemoteHostRuntime(),
  ) {
    this.local = local;
    this.remote = remote;
  }

  runtimeForSession(sessionId: string, source?: SessionSource): ConversationRuntime {
    if (source) return source === 'local-provider' ? this.local : this.remote;
    return sessionId.startsWith('local-') ? this.local : this.remote;
  }

  runtimeForSource(source: SessionSource): ConversationRuntime {
    return source === 'local-provider' ? this.local : this.remote;
  }

  async listSessions(filter: SessionSourceFilter = 'all'): Promise<Session[]> {
    if (filter === 'remote-host') return this.remote.listSessions();
    if (filter === 'local-provider') return this.local.listSessions();
    const results = await Promise.allSettled([
      this.remote.listSessions(),
      this.local.listSessions(),
    ]);
    const sessions = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    if (sessions.length === 0) {
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failure) throw failure.reason;
    }
    return sessions.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  }

  deleteSession(sessionId: string, source?: SessionSource): Promise<void> {
    return this.runtimeForSession(sessionId, source).deleteSession(sessionId);
  }

  createLocalSession(title?: string, providerId?: string): Promise<Session> {
    return this.local.createSession(title, providerId);
  }
}

export const runtimeRegistry = new RuntimeRegistry();
