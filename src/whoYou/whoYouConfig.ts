/** The official browser management entry; MCP endpoints come from Mira ID. */
const WHO_YOU_WEB_MAILBOXES_URL = 'https://who-you.tomz.io/account/mailboxes';

export const WHO_YOU_READ_SCOPE = 'whoyou.read';

export const resolveWhoYouWebMailboxesUrl = (): string =>
  WHO_YOU_WEB_MAILBOXES_URL;

export const normalizeWhoYouMcpUrl = (value: string): string => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Who You MCP resource must be an HTTPS /mcp URL');
  }
  if (
    url.protocol !== 'https:' ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    url.pathname !== '/mcp'
  ) {
    throw new Error('Who You MCP resource must be an HTTPS /mcp URL');
  }
  return url.toString();
};

/**
 * RFC 9728 location for the single `/mcp` resource, matching the deployed
 * Who You metadata route.
 */
export const whoYouResourceMetadataUrl = (mcpUrl: string): string => {
  const resource = new URL(normalizeWhoYouMcpUrl(mcpUrl));
  return `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`;
};
