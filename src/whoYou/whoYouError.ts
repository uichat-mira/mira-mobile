export type WhoYouErrorKind =
  | 'network'
  | 'unavailable'
  | 'session_rejected'
  | 'unauthorized'
  | 'rejected'
  | 'invalid_response'
  | 'not_configured';

/**
 * Fixed, safe failure surface for the Who You read-only client. Raw provider
 * payloads, tokens, session secrets and response bodies never become messages.
 */
export class WhoYouError extends Error {
  constructor(
    readonly kind: WhoYouErrorKind,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'WhoYouError';
  }
}
