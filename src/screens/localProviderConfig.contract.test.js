const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const source = readFileSync(
  resolve(process.cwd(), 'src/screens/LocalProviderConfigScreen.tsx'),
  'utf8',
);

describe('MOB-038 Local Provider configuration', () => {
  it('supports multiple Provider profiles without mixing API keys into config JSON', () => {
    expect(source).toContain('configs.map((item) =>');
    expect(source).toContain('providerCredentialStore.load(next.id)');
    expect(source).toContain('providerCredentialStore.save(next.id, nextApiKey)');
    expect(source).toContain('new ProviderConfigStore().upsert(next)');
  });

  it('keeps stored credentials out of the editable field and preserves them unless replaced', () => {
    expect(source).toContain("const [apiKeyDraft, setApiKeyDraft] = useState('')");
    expect(source).toContain('const [hasStoredKey, setHasStoredKey] = useState(false)');
    expect(source).toContain('value={apiKeyDraft}');
    expect(source).toContain("placeholder={hasStoredKey ? '已保存；输入新 Key 可替换' : '请输入 API Key'}");
    expect(source).toContain('const nextApiKey = apiKeyDraft.trim()');
    expect(source).toContain('if (nextApiKey)');
    expect(source).toContain('if (selectedProviderIdRef.current === next.id)');
    expect(source).not.toContain('********');
  });

  it('clears only the selected Provider credential and ignores stale credential loads', () => {
    expect(source).toContain('credentialLoadRequestRef.current');
    expect(source).toContain('credentialLoadRequestRef.current === requestId');
    expect(source).toContain('const selectedProviderIdRef = useRef(config.id)');
    expect(source).toContain('selectedProviderIdRef.current === providerId');
    expect(source).toMatch(/providerCredentialStore\s*\.clear\(providerId\)/);
    expect(source).toContain('accessibilityLabel="清除 API Key"');
    expect(source).toContain("setApiKeyDraft('')");
    expect(source).toContain('setHasStoredKey(false)');
  });

  it('locks Provider fields while credential or destructive mutations are in flight', () => {
    expect(
      source.match(/editable=\{!saving && !clearingKey && !deletingProvider\}/g)?.length,
    ).toBeGreaterThanOrEqual(4);
    expect(source).toContain('editable={editable}');
    expect(source).toContain('!editable && styles.disabledButton');
  });

  it('creates a local conversation with the selected Provider', () => {
    expect(source).toContain('runtimeRegistry.createLocalSession(undefined, config.id)');
    expect(source).toContain("source: 'local-provider'");
    expect(source).toContain('providerName: config.name');
    expect(source).toContain('providerModel: config.model');
  });

  it('confirms scoped cascade deletion with the current owned conversation count', () => {
    expect(source).toContain('runtimeRegistry.getLocalProviderDeletionImpact(config.id)');
    expect(source).toContain('impact.sessionCount');
    expect(source).toContain('runtimeRegistry.deleteLocalProvider(');
    expect(source).toContain('expectedSessionCount');
    expect(source).toContain("{ text: '取消', style: 'cancel' }");
    expect(source).toContain("style: 'destructive'");
    expect(source).toContain('不会影响其他 Provider、Remote Host、记忆或个性化设置');
    expect(source).not.toContain('当前 Provider 仍有本地对话，请先保留此配置');
  });

  it('cleans device-local references for cascaded conversations', () => {
    expect(source).toContain('result.deletedSessionIds.flatMap((sessionId) =>');
    expect(source).toContain('useThreadPinStore.getState().unpinThread(sessionId)');
    expect(source).toContain('useThreadReadStore.getState().clearThread(sessionId)');
    expect(source).toContain('removeLastOpenedSession(sessionId)');
  });
});
