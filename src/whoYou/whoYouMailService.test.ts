import { WhoYouMailService } from './whoYouMailService';
import type { WhoYouMailReaderClient } from './whoYouMcpClient';

const account = 'account-1';
const stored = { sessionToken: 'test-session', account: { id: account }, expiresAt: '2026-12-01T00:00:00Z' };
const page = { messages: [], nextCursor: null };

const createService = () => {
  const cloud = { status: 'signed_in', accountId: account };
  const loadSession = jest.fn(async () => stored);
  const client: WhoYouMailReaderClient = {
    searchMail: jest.fn(async () => page),
    readMail: jest.fn(async () => ({
      id: 'test', threadId: 'thread', subject: 'test', direction: 'inbound' as const,
      from: [], snippet: '', receivedAt: 1790000000000,
      attachmentCount: 0, body: 'fixture', truncated: false,
    })),
  };
  const service = new WhoYouMailService({
    loadSession, currentCloud: () => cloud, client,
    now: () => Date.parse('2026-11-22T05:00:00Z'),
  });
  return { service, client, cloud, loadSession };
};

describe('WhoYouMailService session ownership', () => {
  it('uses only matching current cloud session and does not persist results', async () => {
    const { service, client } = createService();
    await service.search('  hello  ');
    expect(client.searchMail).toHaveBeenCalledWith({
      sessionToken: stored.sessionToken, accountId: account, query: 'hello',
    });
    await service.read('message-1');
    expect(client.readMail).toHaveBeenCalledWith({
      sessionToken: stored.sessionToken, accountId: account, messageId: 'message-1',
    });
  });

  it('propagates the active Agent cancellation signal to MCP reads', async () => {
    const { service, client } = createService();
    const controller = new AbortController();
    await service.search('hello', undefined, controller.signal);
    expect(client.searchMail).toHaveBeenCalledWith(expect.objectContaining({
      query: 'hello', signal: controller.signal,
    }));
    await service.read('msg-1', controller.signal);
    expect(client.readMail).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'msg-1', signal: controller.signal,
    }));
    controller.abort();
    await expect(service.search('other', undefined, controller.signal))
      .rejects.toMatchObject({ code: 'WHOYOU_REQUEST_CANCELLED' });
    expect(client.searchMail).toHaveBeenCalledTimes(1);
  });

  it('refuses sign-out, identity swap, expired session or session rotation', async () => {
    const { service, client, cloud, loadSession } = createService();
    cloud.status = 'signed_out';
    await expect(service.search()).rejects.toMatchObject({ kind: 'session_rejected' });
    expect(client.searchMail).not.toHaveBeenCalled();
    cloud.status = 'signed_in';
    cloud.accountId = 'account-2';
    await expect(service.search()).rejects.toMatchObject({ kind: 'session_rejected' });
    cloud.accountId = account;
    loadSession.mockResolvedValueOnce({ ...stored, expiresAt: '2026-01-01T00:00:00Z' });
    await expect(service.search()).rejects.toMatchObject({ kind: 'session_rejected' });
    const search = client.searchMail as jest.Mock;
    search.mockImplementationOnce(async () => {
      cloud.status = 'device_revoked';
      return page;
    });
    await expect(service.search()).rejects.toMatchObject({ kind: 'session_rejected' });
    cloud.status = 'signed_in';
    search.mockImplementationOnce(async () => page);
    loadSession.mockResolvedValueOnce(stored).mockResolvedValueOnce({
      ...stored, sessionToken: 'rotated-session',
    });
    await expect(service.search()).rejects.toMatchObject({ kind: 'session_rejected' });
  });
});
