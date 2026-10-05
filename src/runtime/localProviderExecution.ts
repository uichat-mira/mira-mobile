import type {
  OpenAiCompatibleClient,
  OpenAiCompatibleMessage,
  OpenAiCompatibleTool,
} from '../provider/openAiCompatibleClient';
import { filterReasoningTagEvents } from '../provider/reasoningTagFilter';
import type { LocalProviderConfig } from '../provider/providerConfigStore';
import type { RuntimeEvent } from './conversationRuntime';

// Ordinary conversation Provider execution for the Local Provider runtime.
//
// This boundary owns turning a request payload into a Provider event stream and
// applying provider compatibility normalization. It is intentionally free of
// Agent lifecycle, canonical persistence and Memory concerns: the ordinary Chat
// path and the Mobile Agent Loop's per-round `modelCall` both go through it so
// provider compatibility normalization (e.g. reasoning-tag stripping) can never
// diverge between the two paths.

/** Stable per-turn Provider execution handle, reusable across Agent rounds. */
export interface LocalProviderExecutor {
  /** The Provider client bound to this turn, used for run cancellation. */
  readonly client: OpenAiCompatibleClient;
  /** Stream one model request with compatibility normalization applied. */
  streamMessages(
    messages: readonly OpenAiCompatibleMessage[],
    tools?: readonly OpenAiCompatibleTool[],
  ): Promise<AsyncIterable<RuntimeEvent>>;
}

export function createLocalProviderExecutor(
  client: OpenAiCompatibleClient,
  config: LocalProviderConfig,
): LocalProviderExecutor {
  const applyProviderCompatibility = (
    stream: AsyncIterable<RuntimeEvent>,
  ): AsyncIterable<RuntimeEvent> =>
    config.compatibility?.reasoningTags === 'strip'
      ? filterReasoningTagEvents(stream)
      : stream;

  return {
    client,
    async streamMessages(messages, tools) {
      const request =
        tools === undefined
          ? { model: config.model, messages: [...messages] }
          : { model: config.model, messages: [...messages], tools: [...tools] };
      return applyProviderCompatibility(await client.streamChat(request));
    },
  };
}
