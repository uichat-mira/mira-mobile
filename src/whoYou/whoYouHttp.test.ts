import { assertWhoYouResponseTarget } from './whoYouHttp';

const responseWithUrl = (url: string): Response => {
  const response = new Response('{}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  Object.defineProperty(response, 'url', { value: url });
  return response;
};

describe('Who You response target guard', () => {
  it('accepts the configured resource and platform responses without a URL', () => {
    expect(() =>
      assertWhoYouResponseTarget(
        new Response('{}'),
        'https://who-you.tomz.io/mcp',
      ),
    ).not.toThrow();
    expect(() =>
      assertWhoYouResponseTarget(
        responseWithUrl('https://who-you.tomz.io/mcp'),
        'https://who-you.tomz.io/mcp',
      ),
    ).not.toThrow();
  });

  it('rejects a redirected origin or path before a bearer result is used', () => {
    for (const url of [
      'https://evil.example/mcp',
      'https://who-you.tomz.io/other',
    ]) {
      expect(() =>
        assertWhoYouResponseTarget(
          responseWithUrl(url),
          'https://who-you.tomz.io/mcp',
        ),
      ).toThrow(
        expect.objectContaining({
          kind: 'invalid_response',
          code: 'WHOYOU_RESPONSE_TARGET_CHANGED',
        }),
      );
    }
  });
});
