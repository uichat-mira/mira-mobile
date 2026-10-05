import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import type { LocalCaptureMetadata } from './localCaptureRepository';
import {
  useShiyanLocalDrafts,
  type ShiyanLocalDrafts,
  type ShiyanLocalDraftsDeps,
} from './useShiyanLocalDrafts';

const flush = async (rounds = 8): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
};

const capture = (id: string): LocalCaptureMetadata => ({
  id,
  filePath: `/private/shiyan/${id}.m4a`,
  sceneId: 'meeting',
  sceneName: '会议采集',
  title: '',
  startedAt: '2026-10-05T00:00:00.000Z',
  endedAt: '2026-10-05T00:01:00.000Z',
  durationMs: 60000,
  fileSizeBytes: 2048,
  status: 'pending_confirmation',
});

const makeDeps = (overrides: Partial<ShiyanLocalDraftsDeps> = {}): ShiyanLocalDraftsDeps => ({
  listRecoverable: jest.fn(async () => [capture('a')]),
  deleteCapture: jest.fn(async () => undefined),
  ...overrides,
});

let handle: ShiyanLocalDrafts | null = null;
let activeRenderer: ReactTestRenderer.ReactTestRenderer | null = null;

const Probe = ({ deps }: { deps: ShiyanLocalDraftsDeps }) => {
  handle = useShiyanLocalDrafts(deps);
  return null;
};

const renderProbe = async (deps: ShiyanLocalDraftsDeps): Promise<void> => {
  await ReactTestRenderer.act(async () => {
    activeRenderer = ReactTestRenderer.create(<Probe deps={deps} />);
    await flush();
  });
};

afterEach(() => {
  if (activeRenderer) {
    ReactTestRenderer.act(() => {
      activeRenderer?.unmount();
    });
    activeRenderer = null;
  }
  handle = null;
});

describe('useShiyanLocalDrafts', () => {
  it('loads recoverable drafts and clears the loading flag', async () => {
    const deps = makeDeps();
    await renderProbe(deps);

    await ReactTestRenderer.act(async () => {
      handle?.load();
      await flush();
    });

    expect(handle?.drafts).toEqual([capture('a')]);
    expect(handle?.loading).toBe(false);
  });

  it('drops a stale load result after the focus cleanup runs', async () => {
    let resolve: (items: LocalCaptureMetadata[]) => void = () => undefined;
    const pending = new Promise<LocalCaptureMetadata[]>(res => {
      resolve = res;
    });
    const deps = makeDeps({ listRecoverable: jest.fn(() => pending) });
    await renderProbe(deps);

    let cleanup: (() => void) | undefined;
    ReactTestRenderer.act(() => {
      cleanup = handle?.load();
    });
    ReactTestRenderer.act(() => {
      cleanup?.();
    });

    await ReactTestRenderer.act(async () => {
      resolve([capture('a')]);
      await flush();
    });

    expect(handle?.drafts).toEqual([]);
  });

  it('removes one draft and updates the list', async () => {
    const deps = makeDeps({
      listRecoverable: jest.fn(async () => [capture('a'), capture('b')]),
    });
    await renderProbe(deps);

    await ReactTestRenderer.act(async () => {
      handle?.load();
      await flush();
    });
    expect(handle?.drafts).toEqual([capture('a'), capture('b')]);

    await ReactTestRenderer.act(async () => {
      await handle?.remove('a');
    });

    expect(deps.deleteCapture).toHaveBeenCalledWith('a');
    expect(handle?.drafts).toEqual([capture('b')]);
  });
});
