import { cloudSessionStore } from '../cloud/cloudSessionStore';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import { WhoYouError } from './whoYouError';
import {
  whoYouMcpClient,
  type WhoYouMailMessage,
  type WhoYouMailReaderClient,
  type WhoYouMailSearchPage,
  type WhoYouReadSession,
} from './whoYouMcpClient';

/** No mailbox content or access bearer is cached by this service. */
export interface WhoYouMailServiceDependencies {
  loadSession(): Promise<{ sessionToken: string; account: { id: string }; expiresAt: string } | null>;
  currentCloud(): { status: string; accountId: string | null };
  client: WhoYouMailReaderClient;
  now?(): number;
}

export class WhoYouMailService {
  constructor(private readonly deps: WhoYouMailServiceDependencies) {}

  private cloudAccount(): string {
    const cloud = this.deps.currentCloud();
    if (cloud.status !== 'signed_in' || !cloud.accountId) {
      throw new WhoYouError('session_rejected', '请先登录 Mira Cloud，再使用狐邮邮件。');
    }
    return cloud.accountId;
  }

  private async requireSession(): Promise<WhoYouReadSession> {
    const accountId = this.cloudAccount();
    let stored: Awaited<ReturnType<WhoYouMailServiceDependencies['loadSession']>>;
    try {
      stored = await this.deps.loadSession();
    } catch {
      throw new WhoYouError('unavailable', '无法读取 Mira Cloud 会话。');
    }
    const now = (this.deps.now ?? Date.now)();
    if (!stored || stored.account.id !== accountId ||
        !stored.sessionToken || !(Date.parse(stored.expiresAt) > now)) {
      throw new WhoYouError('session_rejected', 'Mira Cloud 登录已失效，请重新登录。');
    }
    this.assertCurrent(accountId);
    return { accountId, sessionToken: stored.sessionToken };
  }

  private assertCurrent(accountId: string): void {
    if (this.cloudAccount() !== accountId) {
      throw new WhoYouError('session_rejected', 'Mira Cloud 账号已切换，本次邮件读取已取消。');
    }
  }

  private async withSession<T>(
    action: (session: WhoYouReadSession) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) throw new WhoYouError('network', '狐邮请求已取消。', 'WHOYOU_REQUEST_CANCELLED');
    const session = await this.requireSession();
    if (signal?.aborted) throw new WhoYouError('network', '狐邮请求已取消。', 'WHOYOU_REQUEST_CANCELLED');
    const result = await action({
      ...session,
      ...(signal ? { signal } : {}),
    });
    if (signal?.aborted) throw new WhoYouError('network', '狐邮请求已取消。', 'WHOYOU_REQUEST_CANCELLED');
    this.assertCurrent(session.accountId);
    // A sign-out followed by a new sign-in to the same account invalidates
    // the old service credential, even though the account id is unchanged.
    const latest = await this.requireSession();
    if (latest.sessionToken !== session.sessionToken) {
      throw new WhoYouError('session_rejected', 'Mira Cloud 会话已更新，请重新查询。');
    }
    return result;
  }

  search(query = '', cursor?: string, signal?: AbortSignal): Promise<WhoYouMailSearchPage> {
    return this.withSession(session => this.deps.client.searchMail({
      ...session,
      ...(query.trim() ? { query: query.trim() } : {}),
      ...(cursor ? { cursor } : {}),
    }), signal);
  }

  read(messageId: string, signal?: AbortSignal): Promise<WhoYouMailMessage> {
    return this.withSession(session => this.deps.client.readMail({
      ...session,
      messageId,
    }), signal);
  }
}

export const whoYouMailService = new WhoYouMailService({
  loadSession: () => cloudSessionStore.load(),
  currentCloud: () => {
    const cloud = useCloudAccountStore.getState();
    return { status: cloud.status, accountId: cloud.account?.id ?? null };
  },
  client: whoYouMcpClient,
});
