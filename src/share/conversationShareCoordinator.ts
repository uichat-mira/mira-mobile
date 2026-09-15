import type { ChatMessage } from '../types';
import { requestShareCardCapture } from './ShareCardCapture';
import { buildShareCardModel, type ShareCardModel } from './shareCardModel';
import { sharePngFile } from './systemShareAdapter';

export interface ConversationShareDependencies {
  capture?: (model: ShareCardModel) => Promise<string>;
  sharePng?: (uri: string, title: string) => Promise<void>;
}

export type ConversationShareResult = 'shared' | 'busy' | 'empty';
export type ConversationShareInput = ShareCardModel | readonly ChatMessage[];

const isPreparedShareCardModel = (
  input: ConversationShareInput,
): input is ShareCardModel => !Array.isArray(input);

/**
 * Own the single-flight boundary between branded-card rasterization and the
 * native platform share sheet. It can prepare a model from a canonical message
 * snapshot, or accept the same prepared model used by the chat UI for immediate
 * empty-state feedback. It has no runtime or persistence access.
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
    input: ConversationShareInput,
    title?: string,
  ): Promise<ConversationShareResult> {
    if (this.active) return 'busy';

    const model = isPreparedShareCardModel(input)
      ? input
      : buildShareCardModel(input, title);
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
