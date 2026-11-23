import type { OpenAiMessage } from '../provider/openAiStandardClient';
import { MobileAgentLoop } from './mobileAgentLoop';
import { PiCoreAgentLoop } from './piAgentLoop';
import type { LocalAgentEngine } from './localAgentEngine';
import type { LocalProviderExecutor } from './localProviderExecution';
import type { RuntimeEvent } from './conversationRuntime';
import type {
  ToolApprovalDecision,
  ToolApprovalRequest,
  ToolGatewayClient,
} from '../tools/toolGatewayClient';

// Local Agent lifecycle only.
//
// Provider request ownership deliberately lives in localProviderExecution.
// This controller owns Agent-specific state: run token, abort signal and the
// single pending approval. Suspension is supplied as a predicate by the caller,
// so Agent runs preserve the existing app-suspended semantics without retaining
// Provider clients after a run finishes.

interface PendingApproval {
  runToken: symbol;
  invocationId: string;
  resolve: (decision: ToolApprovalDecision) => void;
  reject: (error: Error) => void;
}

export interface LocalAgentRunInput {
  executor: LocalProviderExecutor;
  initialMessages: readonly OpenAiMessage[];
  approvalRecipient?: string;
  /** Current user turn used only to bind an explicitly named Cloud Host. */
  selectionText?: string;
  previousAssistantText?: string;
  shouldPause?: () => boolean;
}

export interface LocalAgentRun {
  stream: AsyncIterable<RuntimeEvent>;
  abortController: AbortController;
  runToken: symbol;
}

export type LocalAgentToolGatewaySource =
  | ToolGatewayClient
  | ((selectionText?: string, previousAssistantText?: string) => ToolGatewayClient);

const resolveToolGateway = (
  source: LocalAgentToolGatewaySource,
  selectionText?: string,
  previousAssistantText?: string,
): ToolGatewayClient =>
  typeof source === 'function' ? source(selectionText, previousAssistantText) : source;

export class LocalAgentRunController {
  private activeAbortController: AbortController | null = null;
  private activeRunToken: symbol | null = null;
  private pendingApproval: PendingApproval | null = null;

  constructor(
    private readonly toolGateway: LocalAgentToolGatewaySource,
    private readonly engine: LocalAgentEngine = 'mobile',
  ) {}

  get active(): boolean {
    return this.activeRunToken !== null;
  }

  async beginRun(input: LocalAgentRunInput): Promise<LocalAgentRun> {
    this.supersedeActiveRun('A newer local Agent run replaced the previous run');
    const abortController = new AbortController();
    const runToken = Symbol('local-agent-run');
    this.activeAbortController = abortController;
    this.activeRunToken = runToken;

    try {
      // A source factory supplies a fresh gateway for each run so Cloud account
      // / Host authority and tool aliases never leak into a later Agent run.
      const gateway = resolveToolGateway(
        this.toolGateway,
        input.selectionText,
        input.previousAssistantText,
      );
      const loop = this.engine === 'pi-core'
        ? new PiCoreAgentLoop(gateway)
        : new MobileAgentLoop(gateway);
      const stream = await loop.run(
        input.initialMessages,
        (messages, tools) => input.executor.streamMessages(messages, tools),
        {
          shouldPause: input.shouldPause,
          approvalRecipient: input.approvalRecipient,
          signal: abortController.signal,
          // A Local turn must stay answerable when the approved remote tool
          // channel is temporarily unreachable; Agent mode degrades to a plain
          // model round instead of failing the whole turn.
          onToolChannelUnavailable: 'continue-without-tools',
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

  cancelActiveRun(): void {
    this.activeAbortController?.abort();
    this.activeAbortController = null;
    this.activeRunToken = null;
    this.rejectPendingApproval(new Error('Local Agent run was cancelled'));
  }

  interruptForSuspension(): void {
    this.activeAbortController?.abort();
    this.rejectPendingApproval(new Error('Local Agent run was suspended'));
  }

  private supersedeActiveRun(reason: string): void {
    this.activeAbortController?.abort();
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
