const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const source = (path) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

describe('unpaired Mobile navigation safety', () => {
  it('mounts SessionList and its Settings entry without requiring Desktop credentials', () => {
    const app = source('App.tsx');
    const list = source('src/screens/SessionListScreen.tsx');
    expect(app).toContain('initialRouteName="SessionList"');
    expect(app).not.toContain("hasDeviceCredential ? 'SessionList' : 'Bootstrap'");
    expect(list).toContain('accessibilityLabel="设置"');
    expect(list).toContain("navigation.navigate('Settings')");
  });

  it('repairs unpaired Cloud OAuth stacks and retains access to sessions', () => {
    const callback = source('src/screens/CloudAuthCallbackScreen.tsx');
    expect(callback).toContain("{ name: 'SessionList' }, { name: 'CloudAccount' }");
    expect(callback).not.toContain("const root = hasRemoteCredential");
  });

  it('places a newly created local chat above the SessionList root', () => {
    const config = source('src/screens/LocalProviderConfigScreen.tsx');
    expect(config).toContain("navigation.reset({");
    expect(config).toContain("{ name: 'SessionList' }");
  });
});
