import { CompositeToolGatewayClient } from './compositeToolGatewayClient';
import { localToolGatewayClient } from './localToolGatewayClient';
import { remoteToolGatewayClient } from './remoteToolGatewayClient';

/**
 * Mobile Agent toolset: compiled-in read-only local tools plus the paired Host
 * tools when they are reachable.
 */
export const mobileToolGatewayClient = new CompositeToolGatewayClient(
  localToolGatewayClient,
  remoteToolGatewayClient,
);
