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

  it('offers only standard OpenAI protocol choices', () => {
    expect(source).toContain('OPENAI_STANDARD_PROTOCOL_OPTIONS.map((option) =>');
    expect(source).toContain('OpenAI Chat Completions');
    expect(source).toContain('OpenAI Responses');
    expect(source).not.toContain('OpenAI-compatible Provider');
    expect(source).not.toContain('opencode');
    expect(source).not.toContain('ark');
    expect(source).not.toContain('minimax');
  });

  it('labels HTTP Provider URLs as explicit development-only plaintext connections', () => {
    expect(source).toContain("__DEV__ && /^http:");
    expect(source).toContain('开发模式 · HTTP 明文连接');
    expect(source).toContain('仅用于受信任的局域网调试');
  });

  it('blocks only non-standard migrated configs and keeps reasoning migration notice non-blocking', () => {
    expect(source).toContain('config.requiresStandardProtocolReview');
    expect(source).toContain('Base URL 不是可确认的标准 OpenAI 根地址');
    expect(source).toContain('config.legacyReasoningBehaviorChanged');
    expect(source).toContain('旧版 reasoning-tag 过滤兼容已移除');
    expect(source).toContain('此标准协议配置仍可继续使用');
    expect(source).toContain('normalizeOpenAiStandardBaseUrl(config.baseUrl)');
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
    expect(source).toContain('如该 Provider 正在生成内容，将先停止这些请求再删除');
    expect(source).toContain('不会影响其他 Provider、Remote Host、记忆或个性化设置');
    expect(source).not.toContain('当前 Provider 仍有本地对话，请先保留此配置');
  });

  it('invalidates a destructive confirmation when the selected Provider identity changed', () => {
    expect(source).toContain('selectedProviderIdRef.current !== providerId');
    expect(source).toContain('当前选中的 Provider 已变化');
    expect(source).toContain('刚才的删除确认已失效');
  });

  it('uses a synchronous ref guard for destructive Provider deletion re-entry', () => {
    expect(source).toContain('const deletingProviderRef = useRef(false)');
    expect(source).toContain('if (deletingProviderRef.current) return');
    expect(source).toContain('deletingProviderRef.current = true');
    expect(source).toContain('deletingProviderRef.current = false');
  });

  it('reconfirms when the deletion scope changes before commit', () => {
    expect(source).toContain('error instanceof LocalProviderDeletionScopeChangedError');
    expect(source).toContain('error.actualSessionCount');
    expect(source).toContain("'删除范围已变化'");
    expect(source).toContain('请再次点击“删除当前配置”，按最新范围重新确认');
  });

  it('reloads the persisted Provider list after a successful deletion', () => {
    expect(source).toContain(
      'new ProviderConfigStore().load().catch(() => null)',
    );
    expect(source).not.toContain(
      'const nextConfigs = configs.filter((item) => item.id !== providerId)',
    );
  });

  it('keeps deleted-session references cleaned when canonical session recovery is incomplete', () => {
    expect(source).toContain("error.reason === 'canonical-sessions'");
    expect(source).toContain("'本地对话恢复不完整'");
    expect(source).toContain('为避免幽灵引用');
    expect(source).toContain('置顶、未读和启动恢复引用保持清理状态');
  });

  it('surfaces incomplete rollback as a distinct recovery state', () => {
    expect(source).toContain(
      'error instanceof LocalProviderDeletionRollbackIncompleteError',
    );
    expect(source).toContain("'删除未完整回滚'");
    expect(source).toContain('请重新打开 Local Provider 设置检查配置、API Key 和关联对话');
  });

  it('delegates destructive cleanup to the Local Provider runtime transaction', () => {
    expect(source).toContain(
      'await runtimeRegistry.deleteLocalProvider(providerId, expectedSessionCount)',
    );
    expect(source).not.toContain('useThreadPinStore');
    expect(source).not.toContain('useThreadReadStore');
    expect(source).not.toContain('removeLastOpenedSession');
  });
});
