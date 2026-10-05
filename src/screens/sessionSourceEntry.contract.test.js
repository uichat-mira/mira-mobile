const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const readSource = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('MOB-039 dual-entry session source flow', () => {
  const sessionList = readSource('src/screens/SessionListScreen.tsx');
  const drawer = readSource('src/components/CustomDrawer.tsx');
  const sessionRow = readSource('src/screens/SessionSwipeRow.tsx');
  const sessionCollection = readSource('src/session/sessionCollection.ts');

  it('opens an explicit source picker instead of cycling filters', () => {
    expect(sessionList).toContain('ConnectionSourceDropdown');
    expect(sessionList).toContain("value: 'all', label: '全部任务'");
    expect(sessionList).toContain("value: 'remote-host', label: '远程连接'");
    expect(sessionList).toContain("value: 'local-provider', label: '本地连接'");
    expect(readSource('src/components/ConnectionSourceDropdown.tsx')).toContain('disabled: option.disabled');
  });

  it('keeps remote and local conversations in the drawer through the shared session owner', () => {
    // MOB-067 moved the collection read into the session owner; the drawer now
    // wires it rather than assembling its own list/filter logic.
    expect(drawer).toContain('useSessionCollection');
    expect(drawer).toContain("filter: 'all'");
    expect(drawer).toContain('providerName: session.providerName');
    expect(drawer).toContain('providerModel: session.providerModel');
    // The shared owner is responsible for skipping local sessions when
    // observing Remote unread state.
    expect(sessionCollection).toContain("session.source !== 'local-provider'");
  });

  it('asks for the conversation source before creating from the drawer', () => {
    expect(drawer).toContain("Alert.alert('新建会话', '选择会话来源'");
    expect(drawer).toContain("text: '远程连接'");
    expect(drawer).toContain('miraHostClient.createSession()');
    expect(drawer).toContain("text: '本地连接'");
    expect(drawer).toContain("navigation.navigate('LocalProviderConfig')");
  });

  it('renders a readable local Provider source label', () => {
    expect(sessionRow).toContain("`本地 Provider${item.providerModel ? ` · ${item.providerModel}` : ''}`");
    expect(sessionRow).not.toContain('鏈湴 Provider');
  });
});
