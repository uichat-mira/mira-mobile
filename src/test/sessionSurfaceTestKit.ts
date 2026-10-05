export const createSessionSurfaceThemeMock = () => ({
  useTheme: () => ({
    colors: {
      bg: { canvas: '#fff', card: '#fff', soft: '#eee' },
      border: { soft: '#eee', default: '#ddd' },
      text: {
        ink: '#111',
        base: '#222',
        soft: '#777',
        muted: '#777',
        placeholder: '#aaa',
      },
      primary: '#00f',
      primaryActive: '#009',
      onPrimary: '#fff',
      overlay: 'rgba(0,0,0,0.4)',
    },
  }),
});

export const createSessionSurfacePinStoreMock = (
  pinnedAtByThreadId: Record<string, string> = {},
) => {
  const hydrate = async () => undefined;
  const pinThread = async () => undefined;
  const unpinThread = async () => undefined;
  return {
    useThreadPinStore: (selector: (state: unknown) => unknown) =>
      selector({
        pinnedAtByThreadId,
        hydrate,
        pinThread,
        unpinThread,
      }),
  };
};

export const createSessionSurfaceReadStoreMock = () => {
  const hydrate = async () => undefined;
  const syncSessions = async () => undefined;
  const clearThread = async () => undefined;
  return {
    selectThreadUnread: () => false,
    useThreadReadStore: (selector: (state: unknown) => unknown) =>
      selector({
        progressByThreadId: {},
        hydrate,
        syncSessions,
        clearThread,
      }),
  };
};
