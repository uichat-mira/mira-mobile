import { assertWhoYouResponseTarget, withWhoYouRequestDeadline } from './whoYouHttp';

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

describe('Who You request cancellation', () => {
  it('aborts a pending private request promptly even when fetch ignores AbortSignal', async () => {
    const controller = new AbortController();
    let underlyingSignal: AbortSignal | null = null;
    const operation = jest.fn(async (signal: AbortSignal): Promise<string> => {
      underlyingSignal = signal;
      return new Promise<string>(() => undefined);
    });
    const pending = withWhoYouRequestDeadline(operation, 10_000, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: 'WHOYOU_REQUEST_CANCELLED',
    });
    expect(operation).toHaveBeenCalledTimes(1);
    expect((underlyingSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it('never starts fetching when the parent run is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const operation = jest.fn(async () => 'unreachable');
    await expect(withWhoYouRequestDeadline(operation, 10_000, controller.signal))
      .rejects.toMatchObject({ code: 'WHOYOU_REQUEST_CANCELLED' });
    expect(operation).not.toHaveBeenCalled();
  });
});
