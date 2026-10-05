import { RemoteHostError } from '../api/remoteHttp';
import { ToolGatewayError } from '../tools/toolGatewayClient';
import { ToolPolicyError } from '../tools/toolPolicy';
import {
  getChatHistoryErrorMessage,
  getChatSendErrorMessage,
  readCanonicalSessionTitle,
  readLocalSessionTitle,
} from './chatSessionState';

describe('chatSessionState', () => {
  it('reads the canonical title from the Host session', async () => {
    const getSession = jest.fn().mockResolvedValue({
      id: 'thread-1',
      title: 'Host 最新标题',
      updatedAt: new Date(),
    });

    await expect(
      readCanonicalSessionTitle({ getSession }, 'thread-1'),
    ).resolves.toBe('Host 最新标题');
    expect(getSession).toHaveBeenCalledWith('thread-1');
  });

  it('keeps the existing UI title when the canonical session cannot be read', async () => {
    const getSession = jest.fn().mockRejectedValue(new Error('offline'));

    await expect(
      readCanonicalSessionTitle({ getSession }, 'thread-1'),
    ).resolves.toBeNull();
  });

  it('reads the canonical title from the local runtime session', async () => {
    const getSession = jest.fn().mockResolvedValue({
      title: '本地会话标题',
    });

    await expect(
      readLocalSessionTitle({ getSession }, 'local-1'),
    ).resolves.toBe('本地会话标题');
    expect(getSession).toHaveBeenCalledWith('local-1');
  });

  it('keeps the route title when the local runtime cannot provide a session', async () => {
    const getSession = jest.fn().mockRejectedValue(new Error('missing'));

    await expect(
      readLocalSessionTitle({ getSession }, 'local-1'),
    ).resolves.toBeNull();
    await expect(readLocalSessionTitle({}, 'local-1')).resolves.toBeNull();
  });

  it('distinguishes authorization, missing-thread and network history errors', () => {
    expect(
      getChatHistoryErrorMessage(
        new RemoteHostError('HTTP_401', 'unauthorized', 401),
      ),
    ).toContain('认证');
    expect(
      getChatHistoryErrorMessage(
        new RemoteHostError('HTTP_403', 'forbidden', 403),
      ),
    ).toContain('权限');
    expect(
      getChatHistoryErrorMessage(
        new RemoteHostError('HTTP_404', 'missing', 404),
      ),
    ).toContain('不存在');
    expect(
      getChatHistoryErrorMessage(new RemoteHostError('NETWORK_ERROR', 'offline')),
    ).toContain('网络');
  });

  it('distinguishes local Agent Gateway failures from Provider credential failures', () => {
    expect(
      getChatSendErrorMessage(
        new RemoteHostError('REMOTE_SCOPE_REQUIRED', 'scope required', 403),
        'local-provider',
      ),
    ).toContain('工具权限');

    expect(
      getChatSendErrorMessage(
        new ToolGatewayError(
          'TOOL_APPROVAL_UNCERTAIN',
          'approval uncertain',
        ),
        'local-provider',
      ),
    ).toContain('审批结果暂时无法确认');

    expect(
      getChatSendErrorMessage(
        new ToolPolicyError('Tool arguments are not valid JSON: search'),
        'local-provider',
      ),
    ).toBe('工具参数无效，本轮已停止');
  });

  it('maps local Provider send failures to actionable messages', () => {
    expect(
      getChatSendErrorMessage(
        new RemoteHostError('PROVIDER_TIMEOUT', 'timeout'),
        'local-provider',
      ),
    ).toContain('超时');
    expect(
      getChatSendErrorMessage(
        new RemoteHostError('PROVIDER_REQUEST_FAILED', 'unauthorized', 401),
        'local-provider',
      ),
    ).toContain('API Key');
    expect(
      getChatSendErrorMessage(
        new RemoteHostError('NETWORK_ERROR', 'offline'),
        'local-provider',
      ),
    ).toContain('Provider');
    expect(
      getChatSendErrorMessage(
        new RemoteHostError('PROVIDER_REQUEST_FAILED', 'rate limited', 429),
        'local-provider',
      ),
    ).toContain('频繁');
  });
});
