import type { ChatMessage, Session } from '../types';
import { miraHostClient } from '../api/miraHostClient';
import type { ConversationRuntime, RuntimeEvent } from './conversationRuntime';

export class RemoteHostRuntime implements ConversationRuntime {
  readonly kind = 'remote-host' as const;
  readonly supportsAgent = false;

  listSessions(): Promise<Session[]> {
    return miraHostClient.listSessions();
  }

  deleteSession(sessionId: string): Promise<void> {
    return miraHostClient.deleteSession(sessionId);
  }

  getMessages(sessionId: string): Promise<ChatMessage[]> {
    return miraHostClient.getMessages(sessionId);
  }

  async sendMessage(
    sessionId: string,
    input: string,
    options?: { messageId?: string },
  ): Promise<AsyncIterable<RuntimeEvent>> {
    const stream = await miraHostClient.sendMessage(sessionId, input, options?.messageId);
    return (async function* () {
      for await (const delta of stream) yield { type: 'text-delta' as const, delta };
      yield { type: 'finish' as const, reason: 'stop' };
    })();
  }

  cancelActiveRun(): void {
    miraHostClient.cancelCurrentSend();
  }
}
