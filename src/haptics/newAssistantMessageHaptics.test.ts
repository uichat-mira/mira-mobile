import { Vibration, AppState } from 'react-native';
import type { ChatMessage } from '../types';
import {
  AssistantMessageHapticsObserver,
  selectNewAssistantMessageIds,
} from './newAssistantMessageHaptics';

jest.mock('react-native', () => ({
  Vibration: { vibrate: jest.fn() },
  AppState: { currentState: 'active' },
}));

jest.mock('../screens/generalSettings', () => ({
  loadGeneralSettings: jest.fn(async () => ({ hapticsEnabled: true })),
}));

const { loadGeneralSettings } = jest.requireMock('../screens/generalSettings') as {
  loadGeneralSettings: jest.Mock;
};

const message = (
  id: string,
  role: ChatMessage['role'],
  content = id,
): ChatMessage => ({ id, role, content, timestamp: new Date(1700000000000) });

// The same canonical shape is produced by the Local Provider repository read
// and by the Remote Host message read; the observer must not care which.
const localBatch = (messages: ChatMessage[]) => [...messages];
const remoteSnapshot = (messages: ChatMessage[]) => [...messages];

const setAppState = (state: string) => {
  (AppState as { currentState: string }).currentState = state;
};

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('selectNewAssistantMessageIds', () => {
  it('returns only newly-arrived assistant ids and ignores user/system messages', () => {
    const previous = [message('u1', 'user'), message('a1', 'assistant')];
    const next = [
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('a2', 'assistant'),
      message('s1', 'system'),
    ];

    expect(selectNewAssistantMessageIds(previous, next)).toEqual(['a2']);
  });
});

describe('AssistantMessageHapticsObserver', () => {
  const vibrate = jest.fn();

  const makeObserver = () =>
    new AssistantMessageHapticsObserver({
      vibrate,
      readAppState: () => AppState.currentState,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    vibrate.mockReset();
    loadGeneralSettings.mockResolvedValue({ hapticsEnabled: true });
    setAppState('active');
    (Vibration.vibrate as jest.Mock).mockClear();
  });

  it('vibrates exactly once for a new canonical Assistant message while foreground', async () => {
    const observer = makeObserver();

    observer.observe(localBatch([message('u1', 'user')]));
    await flush();
    expect(vibrate).not.toHaveBeenCalled();

    observer.observe(localBatch([message('u1', 'user'), message('a1', 'assistant')]));
    await flush();
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('does not vibrate again when the same message is re-read via snapshot/refresh', async () => {
    const observer = makeObserver();

    observer.observe(localBatch([message('u1', 'user')]));
    observer.observe(localBatch([message('u1', 'user'), message('a1', 'assistant')]));
    await flush();
    expect(vibrate).toHaveBeenCalledTimes(1);

    // Remote Host can deliver the identical canonical message through repeated
    // snapshots; Local can re-read it after stream completion. Neither is a
    // second arrival.
    observer.observe(remoteSnapshot([message('u1', 'user'), message('a1', 'assistant')]));
    observer.observe(remoteSnapshot([message('u1', 'user'), message('a1', 'assistant')]));
    await flush();
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('never vibrates on the baseline history read of a session', async () => {
    const observer = makeObserver();

    observer.observe(
      localBatch([
        message('u1', 'user'),
        message('a1', 'assistant'),
        message('a2', 'assistant'),
      ]),
    );
    await flush();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('does not vibrate for user messages only', async () => {
    const observer = makeObserver();

    observer.observe(localBatch([]));
    observer.observe(localBatch([message('u1', 'user')]));
    await flush();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('does not vibrate for token deltas / run completion lacking a new canonical message', async () => {
    const observer = makeObserver();

    observer.observe(localBatch([message('u1', 'user'), message('a1', 'assistant')]));
    // A "finish"/tool event run does not change the canonical message set.
    observer.observe(localBatch([message('u1', 'user'), message('a1', 'assistant')]));
    await flush();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('does not vibrate while the app is backgrounded or inactive', async () => {
    const observer = makeObserver();

    observer.observe(localBatch([message('u1', 'user')]));
    setAppState('background');
    observer.observe(localBatch([message('u1', 'user'), message('a1', 'assistant')]));
    await flush();
    expect(vibrate).not.toHaveBeenCalled();

    setAppState('inactive');
    observer.observe(localBatch([message('u1', 'user'), message('a1', 'assistant'), message('a2', 'assistant')]));
    await flush();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('uses the real Vibration path and respects hapticsEnabled = false', async () => {
    loadGeneralSettings.mockResolvedValue({ hapticsEnabled: false });
    const realObserver = new AssistantMessageHapticsObserver();

    realObserver.observe([message('u1', 'user')]);
    realObserver.observe([message('u1', 'user'), message('a1', 'assistant')]);
    await flush();

    expect(Vibration.vibrate).not.toHaveBeenCalled();
  });

  it('fires the real Vibration once when hapticsEnabled = true', async () => {
    const realObserver = new AssistantMessageHapticsObserver();

    realObserver.observe([message('u1', 'user')]);
    realObserver.observe([message('u1', 'user'), message('a1', 'assistant')]);
    await flush();

    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
  });
});
