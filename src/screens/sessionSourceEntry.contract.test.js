const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const readSource = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('MOB-039 dual-entry session source flow', () => {
  const sessionList = readSource('src/screens/SessionListScreen.tsx');
  const drawer = readSource('src/components/CustomDrawer.tsx');
  const sessionRow = readSource('src/screens/SessionSwipeRow.tsx');

  it('opens an explicit source picker instead of cycling filters', () => {
    expect(sessionList).toContain('ConnectionSourceDropdown');
    expect(sessionList).toContain("value: 'all', label: '全部任务'");
    expect(sessionList).toContain("value: 'remote-host', label: '远程连接'");
    expect(sessionList).toContain("value: 'local-provider', label: '本地连接'");
    expect(readSource('src/components/ConnectionSourceDropdown.tsx')).toContain('disabled: option.disabled');
  });

  it('keeps remote and local conversations in the drawer', () => {
    expect(drawer).toContain("runtimeRegistry.listSessions('all')");
    expect(drawer).toContain("session.source !== 'local-provider'");
    expect(drawer).toContain('providerName: session.providerName');
    expect(drawer).toContain('providerModel: session.providerModel');
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
