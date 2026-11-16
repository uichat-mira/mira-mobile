import type { RemoteChatStreamEvent } from '../protocol/remoteHostV1';
import type { PostSseSession } from '../api/postSse';
import { RemoteHostError } from '../api/remoteHttp';
import type { RuntimeEvent } from './conversationRuntime';

export type RemoteRuntimeToolEvent = Extract<
  RemoteChatStreamEvent,
  { type: 'data-tool-event' | 'data-execution-node' }
>;

/**
 * Single Host chat stream contract for every Remote Host transport. It turns
 * canonical SSE events into runtime deltas, keeps structured tool/execution
 * events for the runtime status UI, and never fabricates a successful finish.
 */
export async function* mapRemoteChatStream(
  session: PostSseSession<RemoteChatStreamEvent>,
  onRuntimeEvent?: (event: RemoteRuntimeToolEvent) => void,
): AsyncIterable<RuntimeEvent> {
  let sawFinish = false;

  for await (const event of session.events) {
    if (
      event.type === 'data-tool-event' ||
      event.type === 'data-execution-node'
    ) {
      if (
        event.data &&
        typeof event.data === 'object' &&
        !Array.isArray(event.data)
      ) {
        onRuntimeEvent?.(event as RemoteRuntimeToolEvent);
      }
      continue;
    }

    if (event.type === 'finish') {
      sawFinish = true;
      if (event.finishReason === 'error') {
        throw new RemoteHostError(
          'CHAT_FINISHED_WITH_ERROR',
          'Mira Host finished the chat with an error',
        );
      }
      if (event.finishReason !== 'stop') {
        throw new RemoteHostError(
          'INVALID_FINISH_REASON',
          `Mira Host returned unsupported finish reason: ${event.finishReason}`,
        );
      }
      continue;
    }

    if (event.type === 'text-delta' && typeof event.delta === 'string') {
      yield { type: 'text-delta', delta: event.delta };
      continue;
    }

    if (event.type === 'error') {
      throw new RemoteHostError(
        'CHAT_STREAM_ERROR',
        typeof event.errorText === 'string'
          ? event.errorText
          : 'Mira Host stream failed',
      );
    }
  }

  // [DONE] only closes the SSE reader. A successful chat must also have an
  // explicit finish event from the shared Host stream contract.
  if (!sawFinish) {
    throw new RemoteHostError(
      'CHAT_STREAM_INCOMPLETE',
      'Mira Host closed the chat stream before finish was received',
    );
  }

  yield { type: 'finish', reason: 'stop' };
}
