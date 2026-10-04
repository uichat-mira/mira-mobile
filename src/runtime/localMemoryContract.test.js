const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const read = (relativePath) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

// MOB-064 negative contract: Mobile Local Memory is a Local-Provider-only
// capability. It must never appear in the Remote Host runtime path, and the
// Local Memory context must never be written back into canonical transcripts.

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
    const localRuntime = read('src/runtime/localProviderRuntime.ts');
    expect(localRuntime).toContain('buildMemoryContext');
    expect(localRuntime).toContain('content: memoryContext');
    // The compiled context is only spliced onto requestMessages; the canonical
    // append path must keep writing to the local session repository only.
    expect(localRuntime).toContain('repository.appendMessages');
  });

  it('consolidates with a per-turn consolidator bound to the current Local Provider', () => {
    const localRuntime = read('src/runtime/localProviderRuntime.ts');
    expect(localRuntime).toContain('createLocalProviderConsolidator');
    expect(localRuntime).toContain('memoryService.commitTurn');
    // The consolidator is built per turn and passed into the commit; there is no
    // shared mutable/global consolidator binding.
    expect(localRuntime).toContain('consolidator,');
    expect(localRuntime).not.toContain('setConsolidator');
    expect(localRuntime).not.toContain('configureLocalMemoryConsolidator');

    const memoryRuntime = read('src/memory/runtime.ts');
    expect(memoryRuntime).not.toContain('configureLocalMemoryConsolidator');
  });

  it('runs consolidation through the same provider compatibility normalization', () => {
    const localRuntime = read('src/runtime/localProviderRuntime.ts');
    expect(localRuntime).toContain('applyProviderCompatibility');
  });
});
