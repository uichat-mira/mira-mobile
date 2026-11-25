import { McpServiceBinding } from './mcpServiceBinding';
import {
  WHO_YOU_MCP_SERVICE_ID,
  whoYouMcpServiceDiscovery,
} from './whoYouMcpService';

/**
 * Compiled-in MCP bindings for the Local Provider runtime.
 *
 * Generic Mira ID registrations are added dynamically by
 * `accountServiceRegistry`; this list keeps only services whose existing
 * canonical discovery path has not migrated yet. Each entry still owns its
 * authentication, credential lifecycle, privacy policy and execution adapter,
 * while Pi Core and the local composition gateway stay service-generic.
 */
export const defaultMcpServiceBindings: readonly McpServiceBinding[] = [
  new McpServiceBinding({
    serviceTypeId: WHO_YOU_MCP_SERVICE_ID,
    discovery: whoYouMcpServiceDiscovery,
    requiresCloudAccount: true,
  }),
];
