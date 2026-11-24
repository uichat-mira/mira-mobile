import { useDesktopConnectionStore, type DesktopConnectionMode } from './desktopConnectionAuthority';
import { reconnectActiveDesktop } from './reconnectActiveDesktop';

describe('selected Desktop transport recovery', () => {
  beforeEach(() => useDesktopConnectionStore.setState({ mode: 'none', generation: 0, transitioning: false }));
  afterEach(() => useDesktopConnectionStore.setState({ mode: 'none', transitioning: false }));

  it.each(['direct', 'cloud', 'none'] as const)('recovers only %s', async (mode: DesktopConnectionMode) => {
    useDesktopConnectionStore.setState({ mode });
    const direct = jest.fn(async () => 'direct-ready');
    const cloud = jest.fn(async () => 'cloud-ready');
    await expect(reconnectActiveDesktop({ direct, cloud })).resolves.toBe(mode === 'none' ? null : mode + '-ready');
    expect(direct).toHaveBeenCalledTimes(mode === 'direct' ? 1 : 0);
    expect(cloud).toHaveBeenCalledTimes(mode === 'cloud' ? 1 : 0);
  });

  it('discards late recovery after a switch and never falls back', async () => {
    useDesktopConnectionStore.setState({ mode: 'direct', generation: 1 });
    let finish!: (value: string) => void;
    const direct = jest.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const cloud = jest.fn(async () => 'cloud-ready');
    const pending = reconnectActiveDesktop({ direct, cloud });
    useDesktopConnectionStore.setState({ mode: 'cloud', generation: 2 });
    finish('direct-ready');
    await expect(pending).resolves.toBeNull();
    expect(cloud).not.toHaveBeenCalled();
    await expect(reconnectActiveDesktop({ direct, cloud })).resolves.toBe('cloud-ready');
  });
});
