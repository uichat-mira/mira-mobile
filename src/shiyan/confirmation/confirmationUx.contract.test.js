const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const readSource = path => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Shiyan confirmation UX wiring', () => {
  it('keeps service and custom-scene config reachable without a Shiyan home More button', () => {
    const home = readSource('src/shiyan/ShiyanRecordingScreens.tsx');
    const app = readSource('App.tsx');

    expect(home).toContain("title: '服务配置'");
    expect(home).toContain("title: '自定义场景'");
    expect(home).toContain("navigation.navigate('ShiyanCloudConfig')");
    expect(home).toContain("navigation.navigate('ShiyanSceneConfig')");
    expect(home).not.toContain('accessibilityLabel="更多操作"');
    expect(home).not.toContain('MoreHorizontal');
    expect(home).not.toContain('accessibilityLabel="配置拾言 Cloud"');
    expect(app).toContain(
      '<Stack.Screen name="ShiyanCloudConfig" component={ShiyanCloudConfigScreen} />',
    );
  });

  it('removes the drifted Cloud settings button from the submit page header', () => {
    const submit = readSource('src/shiyan/ShiyanCaptureSubmitScreen.tsx');
    expect(submit).not.toContain('Settings2');
    expect(submit).not.toContain('可点右上角设置');
    expect(submit).toContain('可回到拾言主页的「服务配置」');
  });

  it('keeps playback behind an independent reusable AudioPlayer component', () => {
    const submit = readSource('src/shiyan/ShiyanCaptureSubmitScreen.tsx');
    const player = readSource('src/shiyan/playback/AudioPlayer.tsx');

    expect(submit).toContain("from './playback/AudioPlayer'");
    expect(submit).toContain('<AudioPlayer');
    expect(submit).not.toContain("from './playback/PlaybackAdapter'");
    expect(player).toContain("from './PlaybackAdapter'");
    expect(player).toContain('adapter.load(source)');
    expect(player).toContain('adapter.dispose()');
    expect(player).not.toContain('CaptureTask');
    expect(player).not.toContain('ShiyanCaptureSubmitScreen');
  });

  it('releases playback when the confirmation route loses focus', () => {
    const submit = readSource('src/shiyan/ShiyanCaptureSubmitScreen.tsx');
    const player = readSource('src/shiyan/playback/AudioPlayer.tsx');

    expect(submit).toContain('const isFocused = useIsFocused();');
    expect(submit).toContain('active={isFocused}');
    expect(player).toContain('if (active)');
    expect(player).toContain('adapter.load(source)');
    expect(player).toContain('adapter.dispose()');
  });

  it('stops playback before deleting the local recording file', () => {
    const submit = readSource('src/shiyan/ShiyanCaptureSubmitScreen.tsx');
    const disposeIndex = submit.indexOf('await audioPlayerRef.current?.dispose()');
    const deleteIndex = submit.indexOf('localCaptureRepository.delete(capture.id)');
    expect(disposeIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(disposeIndex);
  });

  it('keeps delete failures visible instead of navigating as if deletion succeeded', () => {
    const submit = readSource('src/shiyan/ShiyanCaptureSubmitScreen.tsx');
    expect(submit).toMatch(/Alert\.alert\(\s*'无法删除'/);
    expect(submit).not.toContain(".catch(() => navigation.navigate('ShiyanLocalDrafts'))");
  });

  it('keeps a full seek surface and maps it through the playback adapter', () => {
    const player = readSource('src/shiyan/playback/AudioPlayer.tsx');
    expect(player).toContain('testID="audio-player-track-area"');
    expect(player).toContain('styles.inactiveTrack');
    expect(player).toContain('styles.playedTrack');
    expect(player).toContain('playbackPositionFromTrackX(');
    expect(player).toContain('adapter.seek(');
  });

  it('clears stale iOS playback before validating a replacement file', () => {
    const ios = readSource('ios/MiraAudioRecorder/MiraAudioRecorder.mm');
    const loadStart = ios.indexOf('RCT_EXPORT_METHOD(playerLoad:');
    const playStart = ios.indexOf('RCT_EXPORT_METHOD(playerPlay:');
    const loadSource = ios.slice(loadStart, playStart);
    const releaseIndex = loadSource.indexOf('[self releasePlayer];');
    const validationIndex = loadSource.indexOf('[self checkedRecordingURL:path error:&error]');

    expect(releaseIndex).toBeGreaterThan(-1);
    expect(validationIndex).toBeGreaterThan(releaseIndex);
    expect(loadSource).toContain('PLAYER_AUDIO_SESSION_FAILED');
  });

  it('picks scenes through a single-choice bottom sheet instead of flat buttons', () => {
    const submit = readSource('src/shiyan/ShiyanCaptureSubmitScreen.tsx');
    expect(submit).toContain('setSceneSheetOpen(true)');
    expect(submit).toContain('setSceneSheetOpen(false)');
    expect(submit).toContain('setSceneId(scene.id);');
    expect(submit).not.toContain('styles.sceneList');
    expect(submit).not.toContain('styles.sceneRadio');
  });

  it('shares one scene truth through the confirmation helpers', () => {
    const submit = readSource('src/shiyan/ShiyanCaptureSubmitScreen.tsx');
    const helpers = readSource('src/shiyan/confirmation/sceneConfirmation.ts');
    expect(submit).toContain('selectableScenesForCapture(');
    expect(submit).toContain('confirmableSceneOrThrow(');
    expect(helpers).toContain('canonicalShiyanSceneId');
  });

  it('keeps one primary submit action and product-facing progress language', () => {
    const submit = readSource('src/shiyan/ShiyanCaptureSubmitScreen.tsx');
    expect(submit).toContain("if (!progress) return '开始整理';");
    expect(submit).toContain("return '正在提交…';");
    expect(submit).toContain('正在上传');
    expect(submit).not.toContain('正在创建任务…');
    expect(submit).not.toContain('正在同步场景…');
    expect(submit).not.toContain('正在确认录音…');
  });
});
