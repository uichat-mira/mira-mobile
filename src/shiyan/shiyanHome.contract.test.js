const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const readSource = path => readFileSync(resolve(process.cwd(), path), 'utf8');
const source = readSource('src/shiyan/ShiyanRecordingScreens.tsx');
const homeSource = source.slice(
  source.indexOf('export function ShiyanHomeScreen()'),
  source.indexOf('export function ShiyanSceneSelectScreen()'),
);

describe('MOB-030 Shiyan home interaction contract', () => {
  it('keeps one direct recording path with the current selected scene', () => {
    expect(homeSource).toContain("navigation.navigate('ShiyanRecord', {");
    expect(homeSource).toContain('sceneId: selectedScene.id');
    expect(homeSource).toContain('sceneName: selectedScene.name');
    expect(homeSource).not.toContain("navigation.navigate('ShiyanSceneSelect')");
  });

  it('selects a scene in the sheet and closes immediately without a confirm step', () => {
    expect(homeSource).toContain('setSelectedSceneId(scene.id);');
    expect(homeSource).toContain('setSceneSheetOpen(false);');
    expect(homeSource).not.toContain('确定');
  });

  it('keeps records behind the all-records shortcut without loading a recent section on home', () => {
    expect(homeSource).toContain("navigation.navigate('ShiyanHistory')");
    expect(homeSource).not.toContain('loadUnifiedRecords()');
    expect(homeSource).not.toContain('最近记录');
    expect(homeSource).not.toContain("navigation.navigate('ShiyanLocalDrafts')");
  });

  it('keeps delivered canonical URLs accessible through the existing task-detail route', () => {
    const appSource = readSource('App.tsx');
    const deliveryDetailSource = readSource(
      'src/shiyan/ShiyanTaskDetailWithDeliveryScreen.tsx',
    );

    expect(appSource).toContain(
      '<Stack.Screen name="ShiyanTaskDetail" component={ShiyanTaskDetailWithDeliveryScreen} />',
    );
    expect(deliveryDetailSource).toContain('hasCanonicalGithubDeliveryEvidence(delivery)');
    expect(deliveryDetailSource).toContain('await Linking.openURL(delivery.fileUrl!);');
    expect(deliveryDetailSource).toContain('打开 GitHub');
  });
});
