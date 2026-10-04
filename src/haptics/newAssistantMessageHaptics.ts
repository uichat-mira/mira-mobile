import { AppState } from 'react-native';
import type { ChatMessage } from '../types';
import { lightImpact } from './haptics';

/**
 * Haptics for "Mira replied" are keyed on the arrival of a new *canonical*
 * Assistant message, not on local actions (sending, creating a session) nor on
 * low-level delivery events (token deltas, tool events, run completion).
 *
 * There is no single runtime-level push channel shared by both paths, so the
 * shared boundary is this observer: each path feeds it through its own real
 * canonical-message arrival point.
 *
 *   - Remote Host publishes canonical messages through
 *     `miraHostClient.subscribeMessageSnapshots` (every canonical read, incl.
 *     the Agent discovery poll and run observation, republishes a snapshot).
 *   - Local Provider has no push channel; its canonical arrival is the
 *     `LocalProviderRuntime.getMessages` read after a send completes.
 *
 * Both hand the same `observe(messages)` the canonical list, so the trigger
 * contract — dedup by canonical id, AppState gating, one vibration per new
 * Assistant message — is identical for Local and Remote.
 */

const isNewAssistantMessage = (
  previousIds: ReadonlySet<string>,
  message: ChatMessage,
): boolean => message.role === 'assistant' && !previousIds.has(message.id);

/**
 * Identity of a canonical Assistant message is its canonical id. Text content
 * must never be used for dedup: the same reply can be re-read after stream
 * completion, a snapshot, or a refresh, and must still count as one arrival.
 */
export function selectNewAssistantMessageIds(
  previous: readonly ChatMessage[],
  next: readonly ChatMessage[],
): string[] {
  const previousIds = new Set(previous.map((message) => message.id));
  return next
    .filter((message) => isNewAssistantMessage(previousIds, message))
    .map((message) => message.id);
}

export interface AssistantMessageHapticsOptions {
  /** Injected for tests; defaults to the real device light impact. */
  vibrate?: () => void | Promise<void>;
  /** Injected for tests; defaults to React Native's AppState.currentState. */
  readAppState?: () => string;
}

export class AssistantMessageHapticsObserver {
  private seenAssistantIds = new Set<string>();
  private seeded = false;
  private readonly vibrate: () => void | Promise<void>;
  private readonly readAppState: () => string;

  constructor(options: AssistantMessageHapticsOptions = {}) {
    this.vibrate = options.vibrate ?? lightImpact;
    this.readAppState = options.readAppState ?? (() => AppState.currentState);
  }

  /**
   * Observe a fresh canonical message read.
   *
   * The first read of a session establishes a baseline (history must never
   * fire haptics); only messages that appear after that baseline count. Each
   * Assistant message is reported at most once for the lifetime of this
   * observer, and the product contract is "one reminder per reply": if a
   * single batch carries N new Assistant messages, N separate reminders fire.
   *
   * Returns the ids that actually triggered a reminder, so callers/tests can
   * verify the per-message contract rather than trusting a side effect.
   */
  observe(messages: readonly ChatMessage[]): string[] {
    const assistantIds = messages
      .filter((message) => message.role === 'assistant')
      .map((message) => message.id);
    const previousIds = this.seenAssistantIds;
    const newlyArrived = assistantIds.filter((id) => !previousIds.has(id));

    const nextSeen = new Set(previousIds);
    for (const id of assistantIds) nextSeen.add(id);
    this.seenAssistantIds = nextSeen;

    if (!this.seeded) {
      // Baseline read: record history without any reminder.
      this.seeded = true;
      return [];
    }

    if (newlyArrived.length === 0) return [];
    if (this.readAppState() !== 'active') return [];

    // One light impact per new Assistant reply, never a single "batch" ping.
    for (let index = 0; index < newlyArrived.length; index += 1) {
      void this.vibrate();
    }
    return newlyArrived;
  }

  /** Test/teardown helper: forget baseline and dedup state. */
  reset(): void {
    this.seenAssistantIds = new Set<string>();
    this.seeded = false;
  }
}
