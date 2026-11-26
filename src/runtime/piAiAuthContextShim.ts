/**
 * Metro-only replacement for `@earendil-works/pi-ai/dist/auth/context.js`.
 *
 * Pi's auth context loads `node:fs/promises` through a variable-specifier
 * dynamic import. Metro cannot transform that call (it requires a literal
 * module id), and the module graph is reached even though Mira never uses Pi's
 * provider auth or model catalog: our Local Provider executor owns the request.
 *
 * This shim keeps the browser-safe part of Pi's contract: no process env and no
 * filesystem. It must not be used for a Pi provider-auth path; that path stays
 * outside this bridge.
 */
export interface MiraPiAuthContext {
  env(name: string): Promise<string | undefined>;
  fileExists(path: string): Promise<boolean>;
}

export const defaultProviderAuthContext = (): MiraPiAuthContext => ({
  async env() {
    return undefined;
  },
  async fileExists() {
    return false;
  },
});
