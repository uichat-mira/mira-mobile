import { WhoYouError } from './whoYouError';

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * React Native's RequestInit typing omits `redirect`, but the runtime accepts
 * it. A bearer-bearing Who You request must never follow an origin redirect.
 */
export type WhoYouRequestInit = RequestInit & { redirect: 'error' };

/**
 * Keeps a stalled native connection from leaving the Who You screen spinning.
 * The deadline covers response-body consumption as well as the initial fetch.
 */
export const withWhoYouRequestDeadline = async <T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
  callerSignal?: AbortSignal,
): Promise<T> => {
  if (callerSignal?.aborted) {
    throw new WhoYouError('network', '狐邮请求已取消。', 'WHOYOU_REQUEST_CANCELLED');
  }
  const controller = new AbortController();
  let abortFromCaller: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    if (!callerSignal) return;
    abortFromCaller = () => {
      controller.abort();
      reject(new WhoYouError('network', '狐邮请求已取消。', 'WHOYOU_REQUEST_CANCELLED'));
    };
    callerSignal.addEventListener('abort', abortFromCaller, { once: true });
    if (callerSignal.aborted) abortFromCaller();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new WhoYouError(
          'network',
          '狐邮请求超时，请稍后重试。',
          'WHOYOU_REQUEST_TIMEOUT',
        ),
      );
    }, timeoutMs);
  });

  const request = Promise.resolve()
    .then(() => {
      if (controller.signal.aborted) {
        throw new WhoYouError('network', '狐邮请求已取消。', 'WHOYOU_REQUEST_CANCELLED');
      }
      return operation(controller.signal);
    })
    .catch((error: unknown) => {
      if (error instanceof WhoYouError) throw error;
      throw new WhoYouError(
        'network',
        '无法连接狐邮，请检查网络后重试。',
        'WHOYOU_NETWORK',
      );
    });

  try {
    return await Promise.race([request, deadline, cancelled]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abortFromCaller) callerSignal?.removeEventListener('abort', abortFromCaller);
  }
};

/**
 * A platform fetch may ignore `redirect: 'error'`. When the response exposes
 * its final URL, still refuse to treat a different origin/path as the approved
 * Who You endpoint that just received a bearer.
 */
export const assertWhoYouResponseTarget = (
  response: Response,
  expectedUrl: string,
): void => {
  if (!response.url) return;
  try {
    const actual = new URL(response.url);
    const expected = new URL(expectedUrl);
    if (
      actual.origin !== expected.origin ||
      actual.pathname !== expected.pathname
    ) {
      throw new WhoYouError(
        'invalid_response',
        '狐邮响应地址与已配置资源不一致。',
        'WHOYOU_RESPONSE_TARGET_CHANGED',
      );
    }
  } catch (error) {
    if (error instanceof WhoYouError) throw error;
    throw new WhoYouError(
      'invalid_response',
      '狐邮返回了无效的响应地址。',
      'WHOYOU_RESPONSE_TARGET_INVALID',
    );
  }
};

export const readSafeErrorCode = async (
  response: Response,
): Promise<string | undefined> => {
  try {
    const body = (await response.json()) as unknown;
    if (
      body !== null &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      'error' in body
    ) {
      const error = (body as { error?: unknown }).error;
      if (error !== null && typeof error === 'object' && !Array.isArray(error)) {
        const code = (error as { code?: unknown }).code;
        if (typeof code === 'string' && /^[A-Za-z0-9._-]{1,80}$/u.test(code)) {
          return code;
        }
      }
    }
  } catch {
    // A non-JSON body is classified only by status and never surfaced.
  }
  return undefined;
};
