import type {
  OpenAiMessage,
  OpenAiStandardClient,
  OpenAiTool,
} from '../provider/openAiStandardClient';
import type { LocalProviderConfig } from '../provider/providerConfigStore';
import type { RuntimeEvent } from './conversationRuntime';

// Provider execution for the Local Provider runtime.
//
// This boundary owns the current Provider execution independently of Agent
// lifecycle. Ordinary Chat and Agent model rounds share the same executor, and
// cancel / app suspension always target the Provider request that is currently
// active. Run handles are identity-scoped so a stale completion can never clear
// a newer execution.

export interface LocalProviderExecutor {
  readonly client: OpenAiStandardClient;
  streamMessages(
    messages: readonly OpenAiMessage[],
    tools?: readonly OpenAiTool[],
  ): Promise<AsyncIterable<RuntimeEvent>>;
}

export interface LocalProviderExecutionRun {
  readonly token: symbol;
  readonly executor: LocalProviderExecutor;
}

export class LocalProviderExecutionController {
  private activeRun: LocalProviderExecutionRun | null = null;
  private suspended = false;

  get executionSuspended(): boolean {
    return this.suspended;
  }

  beginRun(executor: LocalProviderExecutor): LocalProviderExecutionRun {
    const run = {
      token: Symbol('local-provider-execution'),
      executor,
    };
    this.activeRun = run;
    return run;
  }

  finishRun(run: LocalProviderExecutionRun): void {
    if (this.activeRun?.token === run.token) {
      this.activeRun = null;
    }
  }

  cancelActiveRun(): void {
    const active = this.activeRun;
    this.activeRun = null;
    active?.executor.client.cancelActiveRun();
  }

  setExecutionSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (suspended) {
      this.cancelActiveRun();
    }
  }
}

export function createLocalProviderExecutor(
  client: OpenAiStandardClient,
  config: LocalProviderConfig,
): LocalProviderExecutor {
  return {
    client,
    async streamMessages(messages, tools) {
      return client.streamMessages(
        tools === undefined
          ? { model: config.model, messages: [...messages] }
          : { model: config.model, messages: [...messages], tools: [...tools] },
      );
    },
  };
}
