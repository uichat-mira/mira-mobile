import type { ChatMessage } from '../types';
import type { OpenAiCompatibleMessage } from '../provider/openAiCompatibleClient';
import type { PersonalizationSettings } from '../settings/personalizationSettings';
import type { LocalMemoryService } from '../memory';
import { buildLocalPersonalizationContext } from './localPersonalizationContext';
import { buildMemoryContext } from '../memory';

// Local request context assembly for the Local Provider runtime.
//
// The Local Provider request payload is the canonical transcript plus two
// Local-only system contexts, in a fixed order:
//
//   system / agent context -> Personalization -> Local Memory -> conversation
//
// Both Local-only contexts are compiled here, after canonical storage reads, so
// persisted history is never polluted and the Remote Host path (which never
// enters this runtime) can never receive them. Each context is best-effort: a
// read / compile failure degrades to that context being absent rather than
// failing the send, and never rewrites persisted settings.

export interface LocalRequestContextDependencies {
  loadPersonalization: () => Promise<PersonalizationSettings>;
  memoryService: LocalMemoryService;
}

export interface LocalRequestContext {
  /** The full request payload: Local-only system contexts followed by history. */
  messages: OpenAiCompatibleMessage[];
  personalizationContext: string | null;
  memoryContext: string | null;
}

const compilePersonalizationContext = async (
  loadPersonalization: () => Promise<PersonalizationSettings>,
): Promise<string | null> => {
  try {
    return buildLocalPersonalizationContext(await loadPersonalization());
  } catch {
    return null;
  }
};

const compileMemoryContext = async (
  memoryService: LocalMemoryService,
): Promise<string | null> => {
  try {
    return buildMemoryContext(await memoryService.buildContext());
  } catch {
    return null;
  }
};

/**
 * Compile the canonical history plus the Local-only Personalization and Local
 * Memory system contexts into one Provider request payload.
 */
export async function assembleLocalRequestContext(
  canonicalMessages: readonly ChatMessage[],
  dependencies: LocalRequestContextDependencies,
): Promise<LocalRequestContext> {
  const messages = canonicalMessages.map<OpenAiCompatibleMessage>((message) => ({
    role: message.role,
    content: message.content,
  }));

  const personalizationContext = await compilePersonalizationContext(
    dependencies.loadPersonalization,
  );
  if (personalizationContext) {
    messages.unshift({ role: 'system', content: personalizationContext });
  }

  const memoryContext = await compileMemoryContext(dependencies.memoryService);
  if (memoryContext) {
    const insertAt = personalizationContext ? 1 : 0;
    messages.splice(insertAt, 0, { role: 'system', content: memoryContext });
  }

  return { messages, personalizationContext, memoryContext };
}
