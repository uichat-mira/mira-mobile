const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const read = (relativePath) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

// MOB-064 negative contract: Mobile Local Memory is a Local-Provider-only
// capability. It must never appear in the Remote Host runtime path, and the
// Local Memory context must never be written back into canonical transcripts.
//
// #227 moved these responsibilities behind `LocalProviderRuntime` into explicit
// owners: request context assembly (`localRequestContext`), Provider execution
// (`localProviderExecution`), canonical turn execution
// (`localConversationExecution`), and completed-turn consolidation
// (`localTurnConsolidation`). The runtime entry point only resolves Local facts
// and delegates the turn.

describe('MOB-064 local memory boundary contract', () => {
  it('keeps Remote Host runtime and the host client free of any Memory import', () => {
    const remoteRuntime = read('src/runtime/remoteHostRuntime.ts');
    expect(remoteRuntime).not.toMatch(/memory/i);

    const hostClient = read('src/api/miraHostClient.ts');
    expect(hostClient).not.toContain("from '../memory");
    expect(hostClient).not.toContain('localMemoryService');
    expect(hostClient).not.toContain('buildMemoryContext');
  });

  it('injects Memory only into Local requests and never into canonical storage', () => {
    const requestContext = read('src/runtime/localRequestContext.ts');
    expect(requestContext).toContain('buildMemoryContext');
    expect(requestContext).toContain('content: memoryContext');
    // The compiled context is only ever spliced onto the request payload; the
    // canonical append path belongs to the conversation-execution owner.
    const conversationExecution = read(
      'src/runtime/localConversationExecution.ts',
    );
    expect(conversationExecution).toContain('repository.appendMessages');
    const localRuntime = read('src/runtime/localProviderRuntime.ts');
    expect(localRuntime).not.toContain('appendMessages');
  });

  it('consolidates with a per-turn consolidator bound to the current Local Provider', () => {
    const consolidation = read('src/runtime/localTurnConsolidation.ts');
    expect(consolidation).toContain('createLocalProviderConsolidator');
    expect(consolidation).toContain('service.commitTurn');
    expect(consolidation).toContain('consolidator,');
    // The consolidator is built per turn and passed into the commit; there is no
    // shared mutable/global consolidator binding.
    expect(consolidation).not.toContain('setConsolidator');
    expect(consolidation).not.toContain('configureLocalMemoryConsolidator');

    const memoryRuntime = read('src/memory/runtime.ts');
    expect(memoryRuntime).not.toContain('configureLocalMemoryConsolidator');
  });

  it('runs consolidation through the same provider compatibility normalization', () => {
    const execution = read('src/runtime/localProviderExecution.ts');
    expect(execution).toContain('applyProviderCompatibility');
    expect(execution).toContain('filterReasoningTagEvents');
    // The consolidation path delegates to the per-turn executor so it cannot
    // diverge from the chat path's compatibility normalization.
    const consolidation = read('src/runtime/localTurnConsolidation.ts');
    expect(consolidation).toContain('executor.client.streamChat');
    expect(consolidation).toContain('filterReasoningTagEvents');
  });
});
