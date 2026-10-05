import { useCallback, useMemo, useRef, useState } from 'react';
import {
  localCaptureRepository,
  type LocalCaptureMetadata,
} from './localCaptureRepository';

export interface ShiyanLocalDraftsDeps {
  listRecoverable(): Promise<LocalCaptureMetadata[]>;
  deleteCapture(id: string): Promise<void>;
}

export interface ShiyanLocalDrafts {
  drafts: LocalCaptureMetadata[];
  loading: boolean;
  /** Loads recoverable drafts; returns the focus-effect cleanup that drops stale results. */
  load(): () => void;
  remove(id: string): Promise<void>;
}

const createDefaultDeps = (): ShiyanLocalDraftsDeps => ({
  listRecoverable: () => localCaptureRepository.listRecoverable(),
  deleteCapture: id => localCaptureRepository.delete(id),
});

/**
 * Owns the Shiyan local-draft collection independently from the recording
 * session: reading recoverable drafts (with stale-result protection) and
 * deleting a single draft. The screen keeps rendering and the delete confirm.
 */
export const useShiyanLocalDrafts = (deps?: ShiyanLocalDraftsDeps): ShiyanLocalDrafts => {
  const resolvedDeps = useMemo(() => deps ?? createDefaultDeps(), [deps]);
  const depsRef = useRef(resolvedDeps);
  depsRef.current = resolvedDeps;

  const [drafts, setDrafts] = useState<LocalCaptureMetadata[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    depsRef.current
      .listRecoverable()
      .then(items => {
        if (active) setDrafts(items);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const remove = useCallback(async (id: string) => {
    await depsRef.current.deleteCapture(id);
    setDrafts(current => current.filter(item => item.id !== id));
  }, []);

  return { drafts, loading, load, remove };
};
