import { requestShareCardCapture } from './ShareCardCapture';
import type { ShareCardModel } from './shareCardModel';
import { sharePngFile } from './systemShareAdapter';

export interface ConversationShareDependencies {
  capture?: (model: ShareCardModel) => Promise<string>;
  sharePng?: (uri: string, title: string) => Promise<void>;
}

export type ConversationShareResult = 'shared' | 'busy';

/**
 * Own the single-flight boundary between card rasterization and the native
 * platform share sheet. It intentionally has no access to conversation
 * runtimes or persistence, so sharing cannot mutate authoritative chat state.
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

  async share(model: ShareCardModel): Promise<ConversationShareResult> {
    if (this.active) return 'busy';

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
