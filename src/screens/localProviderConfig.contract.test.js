const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const source = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const listSource = source('src/screens/LocalProviderListScreen.tsx');
const editSource = source('src/screens/LocalProviderEditScreen.tsx');
const protocolSource = source('src/provider/openAiStandardProtocol.ts');

describe('MOB-038 Local Provider configuration', () => {
  it('lists multiple saved Provider profiles without mixing API keys into config JSON', () => {
    expect(listSource).toContain('configs.map(renderProvider)');
    expect(listSource).toContain('new ProviderConfigStore().load()');
    expect(editSource).toMatch(/providerCredentialStore\s*\.load\(existing\.id\)/);
    expect(editSource).toContain('providerCredentialStore.save(next.id, nextApiKey)');
    expect(editSource).toContain('new ProviderConfigStore().upsert(next)');
  });

  it('keeps stored credentials out of the editable field and preserves them unless replaced', () => {
    expect(editSource).toContain("const [apiKeyDraft, setApiKeyDraft] = useState('')");
    expect(editSource).toContain('const [hasStoredKey, setHasStoredKey] = useState(false)');
    expect(editSource).toContain('value={apiKeyDraft}');
    expect(editSource).toMatch(/placeholder=\{\s*hasStoredKey\s*\?\s*'已保存；输入新 Key 可替换'\s*:\s*'请输入 API Key'\s*\}/u);
    expect(editSource).toContain('const nextApiKey = apiKeyDraft.trim()');
    expect(editSource).toContain('if (nextApiKey)');
    expect(editSource).not.toContain('********');
  });

  it('clears only the edited Provider credential and ignores stale credential loads', () => {
    expect(editSource).toContain('credentialLoadRequestRef.current');
    expect(editSource).toContain('credentialLoadRequestRef.current === requestId');
    expect(editSource).toMatch(/providerCredentialStore\s*\.clear\(providerId\)/);
    expect(editSource).toContain('accessibilityLabel="清除 API Key"');
    expect(editSource).toContain("setApiKeyDraft('')");
    expect(editSource).toContain('setHasStoredKey(false)');
  });

  it('locks Provider fields while credential or destructive mutations are in flight', () => {
    expect(editSource).toContain(
      'const busy = saving || clearingKey || deletingProvider;',
    );
    expect(editSource).toContain('const fieldsEditable = !busy;');
    expect(editSource.match(/editable=\{fieldsEditable\}/g)?.length).toBe(4);
    expect(editSource).toContain('editable={editable}');
    expect(editSource).toContain('!editable && styles.disabledButton');
  });

  it('offers only standard OpenAI protocol choices', () => {
    expect(editSource).toMatch(/OPENAI_STANDARD_PROTOCOL_OPTIONS\.map\(\s*option\s*=>/u);
    expect(protocolSource).toContain("label: 'OpenAI Chat Completions'");
    expect(protocolSource).toContain("label: 'OpenAI Responses'");
    expect(protocolSource).toContain("endpoint: '/v1/chat/completions'");
    expect(protocolSource).toContain("endpoint: '/v1/responses'");
    expect(protocolSource).not.toContain('OpenAI-compatible Provider');
    expect(protocolSource).not.toContain('opencode');
    expect(protocolSource).not.toContain('ark');
    expect(protocolSource).not.toContain('minimax');
  });

  it('labels HTTP Provider URLs as explicit development-only plaintext connections', () => {
    expect(editSource).toContain('__DEV__ && /^http:');
    expect(editSource).toContain('开发模式 · HTTP 明文连接');
    expect(editSource).toContain('仅用于受信任的局域网调试');
  });

  it('blocks only non-standard migrated configs and keeps reasoning migration notice non-blocking', () => {
    expect(editSource).toContain('config.requiresStandardProtocolReview');
    expect(editSource).toContain('Base URL 不是可确认的标准 API 根地址');
    expect(editSource).toContain('config.legacyReasoningBehaviorChanged');
    expect(editSource).toMatch(/旧版 reasoning-tag\s+过滤兼容已移除/u);
    expect(editSource).toContain('此标准协议配置仍可继续使用');
    expect(editSource).toMatch(/normalizeOpenAiStandardBaseUrl\(\s*config\.baseUrl\s*\)/u);
  });

  it('creates a local conversation from chat-mode selection, not from the config editor', () => {
    expect(listSource).toContain("route.params?.mode === 'create'");
    expect(listSource).toMatch(/runtimeRegistry\.createLocalSession\(\s*undefined,\s*provider\.id,?\s*\)/u);
    expect(listSource).toContain("source: 'local-provider'");
    expect(listSource).toContain('providerName: provider.name');
    expect(listSource).toContain('providerModel: provider.model');
    expect(editSource).not.toContain('runtimeRegistry.createLocalSession(');
    expect(editSource).not.toContain('新建本地对话');
  });

  it('keeps protocol in an expandable section and never pretends the connection has been tested', () => {
    expect(editSource).toContain('advancedOpen');
    expect(editSource).toMatch(/OPENAI_STANDARD_PROTOCOL_OPTIONS\.map\(\s*option\s*=>/u);
    expect(editSource).toContain('尚未测试 · 功能待接入');
    expect(listSource).toContain('未验证连接');
    expect(listSource).not.toContain('openAiStandardProtocolLabel');
    expect(listSource).toMatch(/text:\s*'编辑配置'[\s\S]*?onPress:\s*\(\)\s*=>\s*openProvider\(provider\.id\)/u);
    expect(editSource).toContain('放弃未保存修改？');
  });

  it('confirms scoped cascade deletion with the current owned conversation count', () => {
    expect(editSource).toContain('runtimeRegistry.getLocalProviderDeletionImpact(');
    expect(editSource).toContain('impact.sessionCount');
    expect(editSource).toContain('runtimeRegistry.deleteLocalProvider(');
    expect(editSource).toContain('expectedSessionCount');
    expect(editSource).toContain("{ text: '取消', style: 'cancel' }");
    expect(editSource).toContain("style: 'destructive'");
    expect(editSource).toContain('如该 Provider 正在生成内容，将先停止这些请求再删除');
    expect(editSource).toContain('不会影响其他 Provider、Remote Host、记忆或个性化设置');
    expect(editSource).not.toContain('当前 Provider 仍有本地对话，请先保留此配置');
  });

  it('uses a synchronous ref guard for destructive Provider deletion re-entry', () => {
    expect(editSource).toContain('const deletingProviderRef = useRef(false)');
    expect(editSource).toContain('if (deletingProviderRef.current) return');
    expect(editSource).toContain('deletingProviderRef.current = true');
    expect(editSource).toContain('deletingProviderRef.current = false');
  });

  it('reconfirms when the deletion scope changes before commit', () => {
    expect(editSource).toContain('error instanceof LocalProviderDeletionScopeChangedError');
    expect(editSource).toContain('error.actualSessionCount');
    expect(editSource).toContain("'删除范围已变化'");
    expect(editSource).toContain('请再次点击“删除此配置”，按最新范围重新确认');
  });

  it('reloads the persisted Provider list when the list regains focus', () => {
    expect(listSource).toContain('useFocusEffect(');
    expect(listSource).toContain('void reload()');
    expect(listSource).toContain('new ProviderConfigStore().load()');
    expect(editSource).not.toContain('configs.filter((item) => item.id !== providerId)');
  });

  it('keeps deleted-session references cleaned when canonical session recovery is incomplete', () => {
    expect(editSource).toContain("error.reason === 'canonical-sessions'");
    expect(editSource).toContain("'本地对话恢复不完整'");
    expect(editSource).toContain('为避免幽灵引用');
    expect(editSource).toContain('置顶、未读和启动恢复引用保持清理状态');
  });

  it('surfaces incomplete rollback as a distinct recovery state', () => {
    expect(editSource).toContain(
      'error instanceof LocalProviderDeletionRollbackIncompleteError',
    );
    expect(editSource).toContain("'删除未完整回滚'");
    expect(editSource).toContain('请重新打开模型列表检查配置、API Key 和关联对话');
  });

  it('delegates destructive cleanup to the Local Provider runtime transaction', () => {
    expect(editSource).toMatch(/await runtimeRegistry\.deleteLocalProvider\(\s*providerId,\s*expectedSessionCount,?\s*\)/u);
    expect(editSource).not.toContain('useThreadPinStore');
    expect(editSource).not.toContain('useThreadReadStore');
    expect(editSource).not.toContain('removeLastOpenedSession');
  });
});
