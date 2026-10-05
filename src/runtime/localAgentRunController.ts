import type {
  OpenAiCompatibleClient,
  OpenAiCompatibleMessage,
} from '../provider/openAiCompatibleClient';
import { MobileAgentLoop } from './mobileAgentLoop';
import type { LocalProviderExecutor } from './localProviderExecution';
import type { RuntimeEvent } from './conversationRuntime';
import type {
  ToolApprovalDecision,
  ToolApprovalRequest,
  ToolGatewayClient,
} from '../tools/toolGatewayClient';

// Local Agent run lifecycle for the Local Provider runtime.
//
// This boundary owns run-scoped state that must never leak between runs: the
// active Provider client, the run abort signal/token, the single pending tool
// approval and the execution-suspension flag. The Agent loop itself is delegated
// to `MobileAgentLoop`; this class only starts it, bridges its approval request
// to the mobile approval surface, and tears it down on cancel / suspension /
// newer-run replacement.
//
// Each `beginRun` supersedes the previous run deterministically: the previous
// client is cancelled, its approval is rejected with a replacement error, and
// the previous token is dropped. A stale approval resolution (wrong invocation
// id or dead run token) is therefore ignored rather than resolving a live run.

interface PendingApproval {
  runToken: symbol;
  invocationId: string;
  resolve: (decision: ToolApprovalDecision) => void;
  reject: (error: Error) => void;
}

export interface LocalAgentRunInput {
  executor: LocalProviderExecutor;
  initialMessages: readonly OpenAiCompatibleMessage[];
}

/**
 * A started Agent run: its event stream plus the run-scoped handle the caller
 * must return to `finishRun` when the stream is exhausted. Passing the handle
 * back (instead of re-reading `active` state) keeps teardown correct even when
 * a newer run has already superseded this one.
 */
export interface LocalAgentRun {
  stream: AsyncIterable<RuntimeEvent>;
  abortController: AbortController;
  runToken: symbol;
}

export class LocalAgentRunController {
  private activeClient: OpenAiCompatibleClient | null = null;
  private activeAbortController: AbortController | null = null;
  private activeRunToken: symbol | null = null;
  private pendingApproval: PendingApproval | null = null;
  private executionSuspended = false;

  constructor(private readonly toolGateway: ToolGatewayClient) {}

  get active(): boolean {
    return this.activeRunToken !== null;
  }

  /**
   * Supersede any active run and start a new one. Returns the run's event
   * stream plus its handle. Throws (after cleaning up) if the Agent loop fails
   * to start.
   */
  async beginRun(input: LocalAgentRunInput): Promise<LocalAgentRun> {
    this.supersedeActiveRun('A newer local Agent run replaced the previous run');
    this.activeClient = input.executor.client;
    const abortController = new AbortController();
    const runToken = Symbol('local-agent-run');
    this.activeAbortController = abortController;
    this.activeRunToken = runToken;

    try {
      const stream = await new MobileAgentLoop(this.toolGateway).run(
        input.initialMessages,
        (messages, tools) => input.executor.streamMessages(messages, tools),
        {
          shouldPause: () => this.executionSuspended,
          signal: abortController.signal,
          requestApproval: (approval) =>
            this.waitForApprovalDecision(runToken, approval),
        },
      );
      return { stream, abortController, runToken };
    } catch (error) {
      this.releaseRun(abortController, runToken);
      abortController.abort();
      this.rejectPendingApproval(
        new Error('Local Agent setup failed before the run started'),
        runToken,
      );
      throw error;
    }
  }

  /** Settle the lifecycle after the run's event stream is exhausted. */
  finishRun(run: LocalAgentRun): void {
    this.releaseRun(run.abortController, run.runToken);
    this.rejectPendingApproval(
      new Error('Local Agent run ended before approval was resolved'),
      run.runToken,
    );
  }

  resolveToolApproval(invocationId: string, decision: ToolApprovalDecision): void {
    const pending = this.pendingApproval;
    if (!pending || pending.invocationId !== invocationId) return;
    this.pendingApproval = null;
    pending.resolve(decision);
  }

  /** Cancel the active run and reject any pending approval. */
  cancelActiveRun(): void {
    this.activeAbortController?.abort();
    this.activeAbortController = null;
    this.activeRunToken = null;
    this.activeClient?.cancelActiveRun();
    this.activeClient = null;
    this.rejectPendingApproval(new Error('Local Agent run was cancelled'));
  }

  /**
   * Mark execution suspended. Resuming clears the flag; suspending also aborts
   * the active run and rejects its pending approval.
   */
  setExecutionSuspended(suspended: boolean): void {
    this.executionSuspended = suspended;
    if (!suspended) return;
    this.activeAbortController?.abort();
    this.activeClient?.cancelActiveRun();
    this.rejectPendingApproval(new Error('Local Agent run was suspended'));
  }

  private supersedeActiveRun(reason: string): void {
    const previousClient = this.activeClient;
    this.activeAbortController?.abort();
    previousClient?.cancelActiveRun();
    this.rejectPendingApproval(new Error(reason));
    this.activeAbortController = null;
    this.activeRunToken = null;
  }

  private releaseRun(
    abortController: AbortController | null,
    runToken: symbol | null,
  ): void {
    if (this.activeAbortController === abortController) {
      this.activeAbortController = null;
    }
    if (this.activeRunToken === runToken) {
      this.activeRunToken = null;
    }
  }

  private waitForApprovalDecision(
    runToken: symbol,
    approval: ToolApprovalRequest,
  ): Promise<ToolApprovalDecision> {
    if (this.activeRunToken !== runToken) {
      return Promise.reject(new Error('Local Agent run is no longer active'));
    }
    this.rejectPendingApproval(
      new Error('A newer tool approval replaced the previous request'),
    );

    return new Promise<ToolApprovalDecision>((resolve, reject) => {
      this.pendingApproval = {
        runToken,
        invocationId: approval.invocationId,
        resolve,
        reject,
      };
    });
  }

  private rejectPendingApproval(error: Error, runToken?: symbol): void {
    const pending = this.pendingApproval;
    if (!pending || (runToken && pending.runToken !== runToken)) return;
    this.pendingApproval = null;
    pending.reject(error);
  }
}
