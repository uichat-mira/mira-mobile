import {
  ToolGatewayError,
  type ToolDiscoveryNoticeCode,
  type ToolGatewayClient,
  type ToolManifest,
  type ToolServiceDescriptor,
} from '../tools/toolGatewayClient';
import { McpServiceToolGateway } from '../tools/mcpServiceToolGateway';
import { McpProtocolError } from './mcpProtocolClient';
import { ServiceCapabilitiesUnsupportedError } from './mcpServiceCapabilities';
import type { McpServiceDegradation } from './mcpServiceCapabilities';
import { WhoYouError } from '../whoYou/whoYouError';

/**
 * A trusted discovery adapter returns one account/credential-scoped snapshot.
 * Everything service-specific (authentication, credential lifetime, privacy and
 * execution policy) stays behind this boundary; the generic composition layer
 * only sees a service descriptor, real schemas and an execution gateway.
 */
export interface McpServiceSnapshot {
  service: ToolServiceDescriptor;
  tools: readonly ToolManifest[];
  catalogRevision: string;
  /**
   * Opaque fingerprint of the authorization boundary (account, Host, device,
   * Grant, connection generation). A change invalidates previously disclosed
   * schemas and calls for this binding only.
   */
  bindingKey?: string;
  /** Absolute expiry for the credential/metadata this snapshot depends on. */
  expiresAt?: number;
  /** Real tools already visible without an explicit disclosure round. */
  initialToolNames?: readonly string[];
  /** Tools visible immediately; defaults to the tools allowed by initialToolNames. */
  visibleTools?: readonly ToolManifest[];
  degradation?: McpServiceDegradation;
  /** Executes an already-authorized call for this exact binding. */
  executionGateway?: ToolGatewayClient;
  /** Revalidates identity/scope/generation before discovery, call or approval. */
  assertCurrent?: () => void | Promise<void>;
}

export interface McpServiceDiscovery {
  /** Stable service type expected from this binding, e.g. `who-you`. */
  readonly serviceTypeId?: string;
  discover(input: {
    accountId: string | null;
    signal?: AbortSignal;
  }): Promise<McpServiceSnapshot>;
}

export interface McpServiceBindingOptions {
  /**
   * Stable service type ID, independent of transport/instance details. Omit only
   * for an adapter whose service identity is discovered and must then stay
   * stable for the life of the binding.
   */
  serviceTypeId?: string;
  discovery: McpServiceDiscovery;
  /** Trusted binding that cannot run without a Cloud account/session. */
  requiresCloudAccount?: boolean;
  /** Only used when the snapshot does not bring its own execution gateway. */
  fallbackExecution?: ToolGatewayClient;
  /** Upper bound for reusing otherwise valid discovery metadata. */
  maxAgeMs?: number;
  now?: () => number;
}

export interface McpServiceBindingMetrics {
  /** Real discovery adapter calls, excluding cache hits. */
  discoveryCount: number;
  cacheHits: number;
}

export type McpServiceBindingOutcome =
  | {
      status: 'ready';
      serviceTypeId: string;
      gateway: McpServiceToolGateway;
      snapshot: McpServiceSnapshot;
      fromCache: boolean;
    }
  | { status: 'degraded'; serviceTypeId: string; notice: ToolDiscoveryNoticeCode | null };

/**
 * Metadata reuse is bounded. A valid snapshot can serve repeated runs inside
 * this window, which avoids re-running discovery for every ordinary chat turn,
 * but never survives the credential/snapshot expiry or an identity change.
 */
export const MCP_METADATA_MAX_AGE_MS = 5 * 60_000;

interface CachedBinding {
  accountId: string | null;
  snapshot: McpServiceSnapshot;
  gateway: McpServiceToolGateway;
  discoveredAt: number;
  generation: number;
  expiresAt: number;
  bindingKey: string | null;
}

const degradedNotice = (error: unknown): ToolDiscoveryNoticeCode | null => {
  if (error instanceof WhoYouError) {
    // Session/network unavailability keeps the binding's authorized fallback;
    // a malformed catalog is a real degradation worth surfacing.
    return error.kind === 'invalid_response' ? 'mcp-service-degraded' : null;
  }
  if (error instanceof McpProtocolError) {
    const catalogDefect = error.kind === 'invalid_response' ||
      error.kind === 'unsupported' ||
      error.kind === 'rejected';
    return catalogDefect ? 'mcp-service-degraded' : null;
  }
  if (error instanceof ServiceCapabilitiesUnsupportedError) {
    return 'mcp-service-degraded';
  }
  if (error instanceof ToolGatewayError &&
      error.code === 'MCP_SERVICE_IDENTITY_CHANGED') {
    return 'mcp-service-degraded';
  }
  return null;
};

const identityChanged = (message: string): McpProtocolError =>
  new McpProtocolError('unauthorized', message, 'MCP_BINDING_REPLACED');

const bindingKeyOf = (snapshot: McpServiceSnapshot): string | null =>
  snapshot.bindingKey ?? null;

/**
 * One independently authorized MCP service.
 *
 * A binding owns:
 * - stable service type identity (never the transport instance);
 * - bounded reuse/refresh of its own metadata;
 * - its own credential/identity revalidation and execution adapter;
 * - a generation that invalidates old gateways when this binding is replaced.
 *
 * Failure or removal of one binding must not affect sibling bindings.
 */
export class McpServiceBinding {
  private _serviceTypeId: string | null;
  private readonly fixedServiceTypeId: string | null;
  readonly requiresCloudAccount: boolean;

  private readonly discovery: McpServiceDiscovery;
  private readonly fallbackExecution?: ToolGatewayClient;
  private readonly maxAgeMs: number;
  private readonly now: () => number;
  private cached: CachedBinding | null = null;
  private generation = 0;
  private metrics: McpServiceBindingMetrics = { discoveryCount: 0, cacheHits: 0 };

  constructor(options: McpServiceBindingOptions) {
    this.fixedServiceTypeId = options.serviceTypeId ??
      options.discovery.serviceTypeId ?? null;
    this._serviceTypeId = this.fixedServiceTypeId;
    this.discovery = options.discovery;
    this.requiresCloudAccount = options.requiresCloudAccount ?? false;
    this.fallbackExecution = options.fallbackExecution;
    this.maxAgeMs = options.maxAgeMs ?? MCP_METADATA_MAX_AGE_MS;
    this.now = options.now ?? (() => Date.now());
  }

  get serviceTypeId(): string {
    return this._serviceTypeId ?? 'pending-mcp-service';
  }

  get discoveryMetrics(): McpServiceBindingMetrics {
    return { ...this.metrics };
  }

  /** Drops only this binding's credential/schema cache. */
  invalidate(): void {
    this.cached = null;
  }

  async discover(input: {
    accountId: string | null;
    signal?: AbortSignal;
  }): Promise<McpServiceBindingOutcome> {
    const now = this.now();
    if (this.cached && this.canReuse(this.cached, input.accountId, now)) {
      this.metrics = { ...this.metrics, cacheHits: this.metrics.cacheHits + 1 };
      try {
        await this.assertCurrent(this.cached);
        return {
          status: 'ready',
          serviceTypeId: this.serviceTypeId,
          gateway: this.cached.gateway,
          snapshot: this.cached.snapshot,
          fromCache: true,
        };
      } catch {
        // A cached credential that no longer validates is not authority. Drop
        // only this binding and fall back to its adapter's normal degradation.
        this.invalidate();
        return { status: 'degraded', serviceTypeId: this.serviceTypeId, notice: null };
      }
    }

    this.metrics = {
      ...this.metrics,
      discoveryCount: this.metrics.discoveryCount + 1,
    };
    try {
      const snapshot = await this.discovery.discover({
        accountId: input.accountId,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if (this.fixedServiceTypeId !== null &&
          snapshot.service.id !== this.fixedServiceTypeId) {
        throw new ToolGatewayError(
          'MCP_SERVICE_IDENTITY_CHANGED',
          `MCP binding ${this.fixedServiceTypeId} returned service ${snapshot.service.id}`,
        );
      }
      this._serviceTypeId = snapshot.service.id;
      const generation = ++this.generation;
      await this.assertSnapshotCurrent(snapshot, generation);
      const gateway = this.createGateway(snapshot, generation);
      const expiresAt = snapshot.expiresAt ?? Number.POSITIVE_INFINITY;
      this.cached = {
        accountId: input.accountId,
        snapshot,
        gateway,
        discoveredAt: now,
        generation,
        expiresAt,
        bindingKey: bindingKeyOf(snapshot),
      };
      return {
        status: 'ready',
        serviceTypeId: this.serviceTypeId,
        gateway,
        snapshot,
        fromCache: false,
      };
    } catch (error) {
      // A binding failure is scoped to this service. Ordinary session/transport
      // loss keeps its adapter fallback without a noisy notice; an unexpected
      // defect is surfaced as a degradation, never as a global tool failure.
      const notice = degradedNotice(error);
      return {
        status: 'degraded',
        serviceTypeId: this.serviceTypeId,
        notice: isKnownBindingError(error) ? notice : 'mcp-service-degraded',
      };
    }
  }

  private canReuse(
    cached: CachedBinding,
    accountId: string | null,
    now: number,
  ): boolean {
    if (cached.accountId !== accountId) return false;
    if (cached.expiresAt <= now) return false;
    if (now - cached.discoveredAt > this.maxAgeMs) return false;
    return cached.generation === this.generation;
  }

  private async assertCurrent(cached: CachedBinding): Promise<void> {
    if (cached.generation !== this.generation) {
      throw identityChanged(`MCP binding ${this.serviceTypeId} was replaced`);
    }
    await this.assertSnapshotCurrent(cached.snapshot, cached.generation);
  }

  private async assertSnapshotCurrent(
    snapshot: McpServiceSnapshot,
    generation: number,
  ): Promise<void> {
    if (generation !== this.generation) {
      throw identityChanged(`MCP binding ${this.serviceTypeId} was replaced`);
    }
    await snapshot.assertCurrent?.();
  }

  private createGateway(
    snapshot: McpServiceSnapshot,
    generation: number,
  ): McpServiceToolGateway {
    const executor = snapshot.executionGateway ?? this.fallbackExecution;
    if (!executor) {
      throw new ToolGatewayError(
        'MCP_SERVICE_EXECUTOR_MISSING',
        `MCP binding ${this.serviceTypeId} has no trusted execution adapter`,
      );
    }
    const resolveLocalApproval = executor.resolveApproval?.bind(executor);
    const initialNames = new Set(snapshot.initialToolNames ?? []);
    const visibleTools = snapshot.visibleTools ?? snapshot.tools.filter((tool) =>
      initialNames.has(tool.name),
    );
    return new McpServiceToolGateway({
      snapshot: {
        service: snapshot.service,
        tools: snapshot.tools,
        catalogRevision: snapshot.catalogRevision,
        visibleTools,
        ...(snapshot.degradation !== undefined
          ? { degradation: snapshot.degradation }
          : {}),
        assertCurrent: async () => {
          await this.assertSnapshotCurrent(snapshot, generation);
        },
      },
      executeTool: (request, options) => executor.callTool(request, options),
      ...(resolveLocalApproval
        ? { resolveToolApproval: resolveLocalApproval }
        : {}),
    });
  }
}

const isKnownBindingError = (error: unknown): boolean =>
  error instanceof WhoYouError ||
  error instanceof McpProtocolError ||
  error instanceof ServiceCapabilitiesUnsupportedError ||
  (error instanceof ToolGatewayError &&
    (error.code === 'MCP_SERVICE_UNAUTHORIZED' ||
      error.code === 'MCP_SERVICE_UNAVAILABLE' ||
      error.code === 'MCP_SERVICE_REJECTED' ||
      error.code === 'MCP_SERVICE_IDENTITY_CHANGED'));
