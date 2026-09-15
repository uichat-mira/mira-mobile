import { normalizeLocalFileUri, sharePngFile } from './systemShareAdapter';

describe('systemShareAdapter', () => {
  test('normalizes an absolute path to a file URI', () => {
    expect(normalizeLocalFileUri('/tmp/mira-share-card.png')).toBe(
      'file:///tmp/mira-share-card.png',
    );
  });

  test('preserves an existing URI scheme', () => {
    expect(normalizeLocalFileUri('file:///tmp/card.png')).toBe(
      'file:///tmp/card.png',
    );
  });

  test('rejects an empty capture URI', () => {
    expect(() => normalizeLocalFileUri('   ')).toThrow('Share image URI is empty');
  });

  test('uses iOS core Share with the PNG file URL', async () => {
    const iosShare = jest.fn(async () => ({ action: 'sharedAction' }));

    await sharePngFile('/tmp/card.png', 'Mira 对话', {
      platform: 'ios',
      iosShare,
    });

    expect(iosShare).toHaveBeenCalledTimes(1);
    expect(iosShare).toHaveBeenCalledWith({
      url: 'file:///tmp/card.png',
      title: 'Mira 对话',
    });
  });

  test('uses the Android FileProvider bridge', async () => {
    const androidShare = jest.fn(async () => undefined);

    await sharePngFile('file:///cache/card.png', 'Mira 对话', {
      platform: 'android',
      androidShare,
    });

    expect(androidShare).toHaveBeenCalledTimes(1);
    expect(androidShare).toHaveBeenCalledWith(
      'file:///cache/card.png',
      'Mira 对话',
    );
  });

  test('surfaces unsupported platforms', async () => {
    await expect(
      sharePngFile('/tmp/card.png', 'Mira 对话', { platform: 'windows' }),
    ).rejects.toThrow('Conversation image sharing is unsupported on windows');
  });
});
