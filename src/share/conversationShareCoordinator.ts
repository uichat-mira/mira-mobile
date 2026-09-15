import type { ChatMessage } from '../types';
import { requestShareCardCapture } from './ShareCardCapture';
import { buildShareCardModel, type ShareCardModel } from './shareCardModel';
import { sharePngFile } from './systemShareAdapter';

export interface ConversationShareDependencies {
  capture?: (model: ShareCardModel) => Promise<string>;
  sharePng?: (uri: string, title: string) => Promise<void>;
}

export type ConversationShareResult = 'shared' | 'busy' | 'empty';

/**
 * Own model preparation plus the single-flight boundary between branded-card
 * rasterization and the native platform share sheet. It intentionally has no
 * runtime or persistence access, so sharing cannot mutate authoritative chat
 * state; callers pass only the canonical message snapshot already on screen.
 */
export class ConversationShareCoordinator {
  private active = false;
  private readonly capture: (model: ShareCardModel) => Promise<string>;
  private readonly sharePng: (uri: string, title: string) => Promise<void>;

  constructor(dependencies: ConversationShareDependencies = {}) {
    this.capture = dependencies.capture ?? requestShareCardCapture;
    this.sharePng = dependencies.sharePng ?? sharePngFile;
  }

  get isActive(): boolean {
    return this.active;
  }

  async share(
    messages: readonly ChatMessage[],
    title?: string,
  ): Promise<ConversationShareResult> {
    if (this.active) return 'busy';

    const model = buildShareCardModel(messages, title);
    if (!model) return 'empty';

    this.active = true;
    try {
      const uri = await this.capture(model);
      await this.sharePng(uri, model.title);
      return 'shared';
    } finally {
      this.active = false;
    }
  }
}
