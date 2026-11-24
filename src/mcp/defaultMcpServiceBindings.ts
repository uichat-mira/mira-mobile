import { McpServiceBinding } from './mcpServiceBinding';
import {
  WHO_YOU_MCP_SERVICE_ID,
  whoYouMcpServiceDiscovery,
} from './whoYouMcpService';

/**
 * Trusted MCP service collection for the Local Provider runtime.
 *
 * Adding another independently authorized service means adding a binding whose
 * discovery adapter owns its own authentication, credential lifecycle, policy
 * and execution path. Pi Core and the local composition gateway stay generic.
 */
export const defaultMcpServiceBindings: readonly McpServiceBinding[] = [
  new McpServiceBinding({
    serviceTypeId: WHO_YOU_MCP_SERVICE_ID,
    discovery: whoYouMcpServiceDiscovery,
    requiresCloudAccount: true,
  }),
];
