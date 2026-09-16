const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const source = readFileSync(
  resolve(process.cwd(), 'src/screens/HostConfigScreen.tsx'),
  'utf8',
);
const pairingHookSource = readFileSync(
  resolve(process.cwd(), 'src/pairing/useRemotePairing.ts'),
  'utf8',
);

describe('MOB-036 pairing entry and authorization sheet contract', () => {
  it('keeps the default pairing page focused on scan and paste entry', () => {
    expect(source).toContain('扫描 Mira Desktop 上的配对二维码');
    expect(source).toContain('扫码配对');
    expect(source).toContain('或粘贴配对链接');
    expect(source).toContain('accessibilityLabel="继续"');
    expect(source).not.toContain('pairingDescriptor.challengeId.slice');
    expect(source).not.toContain('pairingState.scopes.join');
  });

  it('opens one authorization sheet after a valid pairing descriptor is loaded', () => {
    expect(source).toContain('setAuthorizationSheetOpen(true);');
    expect(source).toContain('visible={authorizationSheetOpen}');
    expect(source).toContain('Mira 授权');
    expect(source).toContain('已识别配对请求');
    expect(source).toContain('提交后，请在桌面端确认此设备。');
  });

  it('clears an unsubmitted descriptor when the authorization sheet is closed', () => {
    expect(source).toContain('if (pairingBusy) return;');
    expect(source).toContain('setAuthorizationSheetOpen(false);');
    expect(source).toContain('resetPairing();');
    expect(source).toContain('setPairingDescriptor(null);');
  });

  it('resumes an existing pending claim instead of submitting a duplicate claim', () => {
    expect(pairingHookSource).toContain('if (state.pending) {');
    expect(pairingHookSource).toContain('beginPolling(state.pending);');
    expect(pairingHookSource).toContain('正在重新检查桌面确认状态。');
  });

  it('requires a fresh pairing request after a delivered credential could not be saved', () => {
    expect(source).toContain('const pairingDeliveredWithoutSave =');
    expect(source).toContain('!pairingDeliveredWithoutSave &&');
    expect(source).toContain('设备凭证已被领取，但本机没有完成保存，请关闭后重新配对。');
  });

  it('keeps pairing success lightweight and returns to the session list', () => {
    expect(source).toContain('setSuccessToastVisible(true);');
    expect(source).toContain('>配对成功</Text>');
    expect(source).toContain("navigation.reset({ index: 0, routes: [{ name: 'SessionList' }] });");
  });
});
