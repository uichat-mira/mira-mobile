export type OpenAiStandardProtocol =
  | 'openai-chat-completions'
  | 'openai-responses';

export const OPENAI_STANDARD_PROTOCOL_OPTIONS: ReadonlyArray<{
  value: OpenAiStandardProtocol;
  label: string;
  endpoint: string;
}> = [
  {
    value: 'openai-chat-completions',
    label: 'OpenAI Chat Completions',
    endpoint: '/v1/chat/completions',
  },
  {
    value: 'openai-responses',
    label: 'OpenAI Responses',
    endpoint: '/v1/responses',
  },
];

export const normalizeOpenAiStandardBaseUrl = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/u, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Provider URL is not valid');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Provider URL must not contain embedded credentials');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('Provider Base URL must not contain query or fragment');
  }

  const pathname = parsed.pathname.replace(/\/+$/u, '');
  if (pathname !== '' && pathname !== '/v1') {
    throw new Error('Provider Base URL must be the API root or standard /v1 root');
  }

  return `${parsed.protocol}//${parsed.host}${pathname}`;
};

export const isOpenAiStandardBaseUrl = (value: string): boolean => {
  try {
    normalizeOpenAiStandardBaseUrl(value);
    return true;
  } catch {
    return false;
  }
};

export const resolveOpenAiStandardEndpoint = (
  baseUrl: string,
  protocol: OpenAiStandardProtocol,
): string => {
  const normalized = normalizeOpenAiStandardBaseUrl(baseUrl);
  const withoutV1 = normalized.endsWith('/v1')
    ? normalized.slice(0, -3)
    : normalized;
  const suffix =
    protocol === 'openai-responses'
      ? '/v1/responses'
      : '/v1/chat/completions';
  return `${withoutV1}${suffix}`;
};
