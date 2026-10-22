import { Alert, Linking, Platform } from 'react-native';
import type { AppRelease } from './appUpdate';
import { installedDisplayVersion, presentUpdatePrompt } from './updatePrompt';

const mockStart = jest.fn();
const mockIsInAppUpdateSupported = jest.fn();

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Alert: { alert: jest.fn() },
  Linking: { openURL: jest.fn() },
}));

jest.mock('./appUpdateInstall', () => ({
  isInAppUpdateSupported: () => mockIsInAppUpdateSupported(),
}));

jest.mock('./appUpdateStore', () => ({
  useAppUpdateStore: { getState: () => ({ start: mockStart }) },
}));

interface AlertButton {
  text?: string;
  style?: string;
  onPress?: () => void;
}

const alertMock = Alert.alert as unknown as jest.Mock;
const openURLMock = Linking.openURL as unknown as jest.Mock;

const lastAlertBody = (): string => String(alertMock.mock.calls.at(-1)?.[1] ?? '');

const lastAlertButtons = (): AlertButton[] =>
  (alertMock.mock.calls.at(-1)?.[2] as AlertButton[] | undefined) ?? [];

const buttonNamed = (text: string): AlertButton => {
  const button = lastAlertButtons().find((entry) => entry.text === text);
  if (!button) throw new Error(`Alert button "${text}" was not offered`);
  return button;
};

const release: AppRelease = {
  version: { major: 0, minor: 4, patch: 0 },
  displayVersion: '0.4.0-dev',
  notes: '修复若干问题\n第二行',
  apkUrl:
    'https://assets.tomz.io/mira/mobile/dev/releases/0.4.0/uichat-mira-mobile-release.apk',
  sha256: 'a'.repeat(64),
};

beforeEach(() => {
  alertMock.mockReset();
  openURLMock.mockReset();
  openURLMock.mockResolvedValue(undefined);
  mockStart.mockReset();
  mockIsInAppUpdateSupported.mockReset();
  mockIsInAppUpdateSupported.mockReturnValue(true);
  Platform.OS = 'android';
});

describe('presentUpdatePrompt on Android', () => {
  it('asks for consent and starts the in-app download instead of the browser', () => {
    presentUpdatePrompt(release);

    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(buttonNamed('下载并安装')).toBeDefined();

    buttonNamed('下载并安装').onPress?.();

    expect(mockStart).toHaveBeenCalledWith(release);
    expect(openURLMock).not.toHaveBeenCalled();
  });

  it('names both the installed and the available version', () => {
    presentUpdatePrompt(release);

    expect(lastAlertBody()).toContain(installedDisplayVersion);
    expect(lastAlertBody()).toContain(release.displayVersion);
    expect(lastAlertBody()).toContain('修复若干问题');
  });

  it('falls back to the browser when the native installer is unavailable', () => {
    mockIsInAppUpdateSupported.mockReturnValue(false);

    presentUpdatePrompt(release);
    buttonNamed('下载').onPress?.();

    expect(openURLMock).toHaveBeenCalledWith(release.apkUrl);
    expect(mockStart).not.toHaveBeenCalled();
  });
});

describe('presentUpdatePrompt on iOS', () => {
  it('explains that no installable artifact exists and offers nothing to press', () => {
    Platform.OS = 'ios';

    presentUpdatePrompt(release);

    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock.mock.calls[0]).toHaveLength(2);
    expect(lastAlertBody()).toContain('iOS');
    expect(openURLMock).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });
});
