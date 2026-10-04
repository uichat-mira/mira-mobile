import { localKeyValueStore } from '../storage/localKeyValueStore';
import { LocalMemoryRepository } from './localMemoryRepository';
import { LocalMemoryService } from './localMemoryService';
import { LocalMemoryTurnLedger } from './localMemoryTurnLedger';
import type { MemoryConsolidator } from './types';

// Mobile Local Memory Kernel runtime.
//
// This card intentionally ships the Kernel, local storage, the Settings CRUD
// surface and the context snapshot builder only. Automatic consolidation (a
// model call that turns a conversation turn into memory proposals) and the
// injection of memory into the Local Provider runtime are deferred to the
// follow-up Runtime Integration card.
//
// Until then the consolidator is a deterministic no-op that never proposes
// anything. That keeps `commitTurn` safe and idempotent while guaranteeing that
// no model call and no implicit write can happen from this card.

export const noopMemoryConsolidator: MemoryConsolidator = {
  async propose() {
    return [];
  },
};

let localMemoryService: LocalMemoryService | undefined;

export const getLocalMemoryService = (): LocalMemoryService => {
  if (!localMemoryService) {
    const repository = new LocalMemoryRepository(localKeyValueStore);
    localMemoryService = new LocalMemoryService(
      repository,
      noopMemoryConsolidator,
      new LocalMemoryTurnLedger(localKeyValueStore),
    );
  }
  return localMemoryService;
};
