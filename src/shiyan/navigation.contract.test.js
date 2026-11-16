const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const readSource = path => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Shiyan navigation contract', () => {
  it('keeps Drawer -> Plugins -> Shiyan wired to the real stack routes', () => {
    const drawer = readSource('src/session/CustomDrawer.tsx');
    const shiyan = readSource('src/shiyan/ShiyanScreens.tsx');
    const app = readSource('App.tsx');

    expect(drawer).toContain("navigation.navigate('Plugins')");
    expect(shiyan).toContain("navigation.navigate('ShiyanHome')");

    expect(app).toContain('<Stack.Screen name="Plugins" component={PluginsScreen} />');
    expect(app).toContain('<Stack.Screen name="ShiyanHome" component={ShiyanHomeScreen} />');
  });

  it('keeps Shiyan reachable before Host pairing through the main drawer', () => {
    const app = readSource('App.tsx');
    const list = readSource('src/screens/SessionListScreen.tsx');
    const drawer = readSource('src/session/CustomDrawer.tsx');
    const bootstrap = readSource('src/screens/BootstrapScreen.tsx');

    // A non-paired launch must reach the main drawer and its Plugins entry.
    expect(app).toContain('initialRouteName="SessionList"');
    expect(list).toContain('accessibilityLabel="打开菜单"');
    expect(list).toContain('<CustomDrawer');
    expect(drawer).toContain("navigation.navigate('Plugins')");
    // Explicit onboarding/legacy entry remains registered and functional.
    expect(app).toContain('<Stack.Screen name="Bootstrap" component={BootstrapScreen} />');
    expect(bootstrap).toContain("navigation.navigate('HostConfig')");
    expect(bootstrap).toContain("navigation.navigate('Plugins')");
  });

  it('keeps both required Shiyan Home destinations registered and reachable', () => {
    const shiyan = readSource('src/shiyan/ShiyanScreens.tsx');
    const app = readSource('App.tsx');

    expect(shiyan).toContain("navigation.navigate('ShiyanSceneSelect')");
    expect(shiyan).toContain("navigation.navigate('ShiyanHistory')");

    expect(app).toContain(
      '<Stack.Screen name="ShiyanSceneSelect" component={ShiyanSceneSelectScreen} />',
    );
    expect(app).toContain(
      '<Stack.Screen name="ShiyanHistory" component={ShiyanHistoryScreen} />',
    );
    expect(app).toContain(
      '<Stack.Screen name="ShiyanSceneConfig" component={ShiyanSceneConfigScreen} />',
    );
  });
});
