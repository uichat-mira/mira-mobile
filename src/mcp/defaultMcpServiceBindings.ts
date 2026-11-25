import type { McpServiceBinding } from './mcpServiceBinding';

/** Account services are discovered solely from the Mira ID registry.
 * Desktop remains bound through its separate Host Grant / Direct path. */
export const defaultMcpServiceBindings: readonly McpServiceBinding[] = [];
