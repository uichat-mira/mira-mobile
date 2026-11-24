import type { Session, SessionSource } from '../types';
import { RemoteHostError } from '../api/remoteHttp';
import { useDesktopConnectionStore } from '../connectivity/desktopConnectionAuthority';
import { LocalProviderRuntime } from './localProviderRuntime';
import { RemoteHostRuntime } from './remoteHostRuntime';
import { CloudHostRuntime } from './cloudHostRuntime';
import type { ConversationRuntime } from './conversationRuntime';
import { createLocalAgentToolGateway } from '../tools/localAgentToolGateway';

export type SessionSourceFilter = 'all' | SessionSource;

export class RuntimeRegistry {
  readonly remote: RemoteHostRuntime;
  readonly cloud: CloudHostRuntime;
  readonly local: LocalProviderRuntime;

  constructor(
    local = new LocalProviderRuntime({
      toolGateway: createLocalAgentToolGateway,
    }),
    remote = new RemoteHostRuntime(),
    cloud = new CloudHostRuntime(),
  ) {
    this.local = local;
    this.remote = remote;
    this.cloud = cloud;
  }

  runtimeForSession(sessionId: string, source?: SessionSource): ConversationRuntime {
    if (source === 'local-provider') return this.local;
    if (source === 'cloud-host') return this.cloud;
    if (source) return this.remote;
    return sessionId.startsWith('local-') ? this.local : this.remote;
  }

  runtimeForSource(source: SessionSource): ConversationRuntime {
    return source === 'local-provider' ? this.local : source === 'cloud-host' ? this.cloud : this.remote;
  }

  async listSessions(filter: SessionSourceFilter = 'all'): Promise<Session[]> {
    const { mode, generation, transitioning } = useDesktopConnectionStore.getState();
    const selected = !transitioning && mode === 'direct' ? this.remote
      : !transitioning && mode === 'cloud' ? this.cloud : null;
    const readSelected = async (): Promise<Session[]> => {
      if (!selected) return [];
      const sessions = await selected.listSessions();
      const current = useDesktopConnectionStore.getState();
      if (current.generation !== generation || current.mode !== mode || current.transitioning) return [];
      if (mode === 'cloud') useDesktopConnectionStore.setState({ cloudConnectionStatus: 'connected' });
      return sessions;
    };
    if (filter === 'remote-host' || filter === 'cloud-host') {
      if ((filter === 'remote-host' && selected !== this.remote) ||
          (filter === 'cloud-host' && selected !== this.cloud)) return [];
      return readSelected();
    }
    if (filter === 'local-provider') return this.local.listSessions();
    const results = await Promise.allSettled([
      readSelected(),
      this.local.listSessions(),
    ]);
    const sessions = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    if (sessions.length === 0) {
      const [remote, local] = results;
      // A missing Desktop pairing is not a global list failure. Users who
      // only configure a Local Provider legitimately have no Remote threads.
      if (local.status === 'rejected') throw local.reason;
      if (remote.status === 'rejected' &&
          !(remote.reason instanceof RemoteHostError &&
            remote.reason.code === 'PAIRING_REQUIRED')) {
        throw remote.reason;
      }
    }
    return sessions.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  }

  deleteSession(sessionId: string, source?: SessionSource): Promise<void> {
    return this.runtimeForSession(sessionId, source).deleteSession(sessionId);
  }

  createLocalSession(title?: string, providerId?: string): Promise<Session> {
    return this.local.createSession(title, providerId);
  }

  getLocalProviderDeletionImpact(providerId: string) {
    return this.local.getProviderDeletionImpact(providerId);
  }

  deleteLocalProvider(providerId: string, expectedSessionCount?: number) {
    return this.local.deleteProvider(providerId, expectedSessionCount);
  }
}

export const runtimeRegistry = new RuntimeRegistry();
