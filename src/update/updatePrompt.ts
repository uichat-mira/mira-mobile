import { Alert, Linking, Platform } from 'react-native';
import { releaseChannel } from 'mira-release-channel';
import { version } from '../../package.json';
import type { AppRelease } from './appUpdate';
import { isInAppUpdateSupported } from './appUpdateInstall';
import { useAppUpdateStore } from './appUpdateStore';

export const installedDisplayVersion: string =
  releaseChannel === 'prod' ? version : `${version}-${releaseChannel}`;

const releaseNotesPreview = (notes: string | null): string => {
  const firstLine = notes
    ?.split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return '';
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
};

export function presentUpdatePrompt(latest: AppRelease): void {
  const notes = releaseNotesPreview(latest.notes);
  const details = `当前版本 ${installedDisplayVersion}\n最新版本 ${latest.displayVersion}${
    notes ? `\n\n${notes}` : ''
  }`;

  if (Platform.OS !== 'android') {
    Alert.alert(
      '发现新版本',
      `${details}\n\niOS 当前没有可直接安装的已签名分发产物。`,
    );
    return;
  }

  if (!isInAppUpdateSupported()) {
    // The in-app installer lives in the Android project, so JS and native can
    // drift apart (for example a JS-only bundle update). Keep the previous
    // browser hand-off instead of showing a button that cannot do anything.
    Alert.alert('下载新版本', `${details}\n\n确认后将使用系统下载。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '下载',
        onPress: () => {
          Linking.openURL(latest.apkUrl).catch(() => {
            Alert.alert('打开下载失败', '请稍后重试。');
          });
        },
      },
    ]);
    return;
  }

  Alert.alert('发现新版本', `${details}\n\n确认后将在应用内下载并安装。`, [
    { text: '取消', style: 'cancel' },
    {
      text: '下载并安装',
      onPress: () => {
        useAppUpdateStore.getState().start(latest);
      },
    },
  ]);
}
