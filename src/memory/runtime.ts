import { localKeyValueStore } from '../storage/localKeyValueStore';
import { LocalMemoryRepository } from './localMemoryRepository';
import { LocalMemoryService } from './localMemoryService';
import { LocalMemoryTurnLedger } from './localMemoryTurnLedger';

// Mobile Local Memory Kernel runtime.
//
// The Kernel ships local storage, the Settings CRUD surface, the context
// snapshot builder and the deterministic turn ledger. Automatic consolidation
// (a model call that turns a completed conversation turn into memory
// proposals) is owned by the Runtime Integration card.
//
// The consolidator is NOT held here. `LocalMemoryService.commitTurn` receives a
// per-turn consolidator bound to the exact Local Provider client / model that
// produced that turn, so concurrent sessions with different Providers can never
// leak across each other. This module only exposes the shared service instance
// that the Settings surface and the Local runtime both use.

let localMemoryService: LocalMemoryService | undefined;

export const getLocalMemoryService = (): LocalMemoryService => {
  if (!localMemoryService) {
    localMemoryService = new LocalMemoryService(
      new LocalMemoryRepository(localKeyValueStore),
      new LocalMemoryTurnLedger(localKeyValueStore),
    );
  }
  return localMemoryService;
};
