import {
  normalizeWhoYouMcpUrl,
  resolveWhoYouMcpUrl,
  resolveWhoYouWebMailboxesUrl,
  WHO_YOU_AUDIENCE,
  WHO_YOU_READ_SCOPE,
  whoYouResourceMetadataUrl,
} from './whoYouConfig';

describe('Who You resource configuration', () => {
  it('uses the approved official resource and read scope', () => {
    expect(resolveWhoYouMcpUrl()).toBe('https://who-you.tomz.io/mcp');
    expect(WHO_YOU_AUDIENCE).toBe('mira:who-you');
    expect(WHO_YOU_READ_SCOPE).toBe('whoyou.read');
    expect(resolveWhoYouWebMailboxesUrl()).toBe(
      'https://who-you.tomz.io/account/mailboxes',
    );
  });

  it('derives the RFC 9728 discovery URL for the single /mcp resource', () => {
    expect(whoYouResourceMetadataUrl('https://who-you.tomz.io/mcp')).toBe(
      'https://who-you.tomz.io/.well-known/oauth-protected-resource/mcp',
    );
  });

  it('rejects non-HTTPS, credential-bearing, query, fragment and non-/mcp resources', () => {
    for (const value of [
      'http://who-you.tomz.io/mcp',
      'https://user:pass@who-you.tomz.io/mcp',
      'https://who-you.tomz.io/mcp?x=1',
      'https://who-you.tomz.io/mcp#fragment',
      'https://who-you.tomz.io/other',
      'not a url',
    ]) {
      expect(() => normalizeWhoYouMcpUrl(value)).toThrow(
        'Who You MCP resource must be an HTTPS /mcp URL',
      );
    }
  });
});
