import type {
  ToolCapabilityDescriptor,
  ToolManifest,
  ToolServiceDescriptor,
} from '../tools/toolGatewayClient';
import type { McpServerInfo, McpToolDescriptor } from './mcpProtocolClient';

/** Optional OPS-046 / `mira.service-capabilities/v1` resource contract. */
export const SERVICE_CAPABILITIES_SCHEMA_VERSION = 'mira.service-capabilities/v1';

export type ServiceAccessMode = 'read' | 'write' | 'send' | 'destructive';
export type ServiceConfirmation =
  | 'none'
  | 'confirm-argument'
  | 'identity-credential'
  | 'draft-credential';

export interface ServiceCapabilityV1 {
  id: string;
  title: string;
  description: string;
  access: ServiceAccessMode;
  requiredScopes: readonly string[];
  confirmation: ServiceConfirmation;
  tools: readonly string[];
}

export interface ServiceCapabilitiesV1 {
  schema: typeof SERVICE_CAPABILITIES_SCHEMA_VERSION;
  version: string;
  service: {
    id: string;
    name: string;
    description: string;
    documentation: string;
    mcp: {
      serverName: string;
      serverVersion: string;
      sdk: string;
      protocolVersions: readonly string[];
    };
  };
  capabilities: readonly ServiceCapabilityV1[];
  fallback: { unknownSchema: string; unclassifiedTools: string };
}

export class ServiceCapabilitiesUnsupportedError extends Error {
  constructor(readonly code: string) {
    super('Service capability declaration is not a supported v1 document');
    this.name = 'ServiceCapabilitiesUnsupportedError';
  }
}

export type McpServiceDegradation =
  | 'none'
  | 'no-resource'
  | 'unknown-schema'
  | 'identity-mismatch'
  | 'unclassified-tools';

export interface McpServiceProjection {
  service: ToolServiceDescriptor;
  /** Real `tools/list` schemas for tools permitted by the local policy. */
  tools: readonly ToolManifest[];
  catalogRevision: string;
  degradation: McpServiceDegradation;
}

export interface ProjectMcpServiceOptions {
  /** Trusted stable service identity owned by the caller, never model text. */
  serviceId: string;
  serviceName: string;
  serviceDescription?: string;
  toolDescriptors: readonly McpToolDescriptor[];
  /** Parsed `resources/read` JSON, or null when the optional resource is absent. */
  capabilityResource?: unknown;
  /** Runtime-confirmed bearer scopes; service declarations never grant scopes. */
  grantedScopes: readonly string[];
  /**
   * Scopes this trusted binding requires before it projects anything. Service
   * declarations never grant scopes; an absent/empty list means no scope is
   * required for this binding.
   */
  requiredScopes?: readonly string[];
  /**
   * Local capability-access policy for this binding. A declared capability is
   * grouped only when its access mode is explicitly permitted here; read-only
   * is not a generic default. Grouping never grants execution authority.
   */
  permittedAccess: readonly ServiceAccessMode[];
  /**
   * Local execution policy. Only these real tools can be disclosed or called;
   * `access` / `confirmation` in the resource are hints, not permission.
   */
  permittedToolNames: readonly string[];
  /** Trusted local privacy role, never derived from the remote declaration. */
  sensitiveResultFor?: (name: string) => ToolManifest['sensitiveResult'];
  serverInfo?: McpServerInfo;
}

const fail = (code: string): never => {
  throw new ServiceCapabilitiesUnsupportedError(code);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const nonEmpty = (value: unknown, max = 4_000): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

const requireKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`);
  }
};

const readString = (
  value: unknown,
  path: string,
  max: number,
): string => (nonEmpty(value, max) ? value : fail(path));

const readStringArray = (
  value: unknown,
  path: string,
  maxEntries: number,
): string[] => {
  if (!Array.isArray(value) || value.length === 0 ||
      value.length > maxEntries ||
      !value.every((entry) => nonEmpty(entry, 1_024))) {
    return fail(path);
  }
  const strings = value as string[];
  if (new Set(strings).size !== strings.length) fail(path);
  return strings;
};

const ACCESS_MODES = new Set<ServiceAccessMode>([
  'read',
  'write',
  'send',
  'destructive',
]);
const CONFIRMATIONS = new Set<ServiceConfirmation>([
  'none',
  'confirm-argument',
  'identity-credential',
  'draft-credential',
]);

/**
 * Strict, bounded parser for the v1 document. Any unknown field, version or
 * shape is treated as unsupported so the consumer can fall back to the real
 * `tools/list` instead of guessing capability groups.
 */
export const parseServiceCapabilitiesV1 = (
  value: unknown,
): ServiceCapabilitiesV1 => {
  if (!isRecord(value)) return fail('root');
  requireKeys(
    value,
    ['schema', 'version', 'service', 'capabilities', 'fallback'],
    'root',
  );
  if (value.schema !== SERVICE_CAPABILITIES_SCHEMA_VERSION) {
    return fail('schema');
  }
  if (!nonEmpty(value.version, 40) ||
      !/^\d+\.\d+\.\d+$/u.test(value.version)) {
    return fail('version');
  }
  if (!isRecord(value.service)) return fail('service');
  requireKeys(
    value.service,
    ['id', 'name', 'description', 'documentation', 'mcp'],
    'service',
  );
  const service = {
    id: readString(value.service.id, 'service.id', 160),
    name: readString(value.service.name, 'service.name', 160),
    description: readString(value.service.description, 'service.description', 600),
    documentation: readString(value.service.documentation, 'service.documentation', 2_048),
    mcp: (() => {
      const mcp = value.service.mcp;
      if (!isRecord(mcp)) return fail('service.mcp');
      requireKeys(
        mcp,
        ['serverName', 'serverVersion', 'sdk', 'protocolVersions'],
        'service.mcp',
      );
      return {
        serverName: readString(mcp.serverName, 'service.mcp.serverName', 160),
        serverVersion: readString(mcp.serverVersion, 'service.mcp.serverVersion', 160),
        sdk: readString(mcp.sdk, 'service.mcp.sdk', 200),
        protocolVersions: readStringArray(
          mcp.protocolVersions,
          'service.mcp.protocolVersions',
          16,
        ),
      };
    })(),
  };
  if (!Array.isArray(value.capabilities) || value.capabilities.length === 0 ||
      value.capabilities.length > 128) {
    return fail('capabilities');
  }
  const capabilityIds = new Set<string>();
  const mappedTools = new Set<string>();
  const capabilities = value.capabilities.map((raw): ServiceCapabilityV1 => {
    if (!isRecord(raw)) return fail('capability');
    requireKeys(
      raw,
      ['id', 'title', 'description', 'access', 'requiredScopes', 'confirmation', 'tools'],
      'capability',
    );
    const id = readString(raw.id, 'capability.id', 160);
    if (capabilityIds.has(id)) fail('capability.id');
    capabilityIds.add(id);
    if (!ACCESS_MODES.has(raw.access as ServiceAccessMode)) {
      return fail('capability.access');
    }
    if (!CONFIRMATIONS.has(raw.confirmation as ServiceConfirmation)) {
      return fail('capability.confirmation');
    }
    const tools = readStringArray(raw.tools, 'capability.tools', 64);
    for (const name of tools) {
      if (mappedTools.has(name)) fail('capability.tools.duplicate');
      mappedTools.add(name);
    }
    return {
      id,
      title: readString(raw.title, 'capability.title', 120),
      description: readString(raw.description, 'capability.description', 600),
      access: raw.access as ServiceAccessMode,
      requiredScopes: readStringArray(
        raw.requiredScopes,
        'capability.requiredScopes',
        16,
      ),
      confirmation: raw.confirmation as ServiceConfirmation,
      tools,
    };
  });
  if (!isRecord(value.fallback)) return fail('fallback');
  requireKeys(value.fallback, ['unknownSchema', 'unclassifiedTools'], 'fallback');
  return {
    schema: SERVICE_CAPABILITIES_SCHEMA_VERSION,
    version: value.version,
    service,
    capabilities,
    fallback: {
      unknownSchema: readString(
        value.fallback.unknownSchema,
        'fallback.unknownSchema',
        400,
      ),
      unclassifiedTools: readString(
        value.fallback.unclassifiedTools,
        'fallback.unclassifiedTools',
        400,
      ),
    },
  };
};

/** Two independent rolling hashes; a stable opaque revision, not a security hash. */
const revisionHash = (input: string): string => {
  let first = 5381;
  let second = 52711;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = (first * 33 + code) % 0x7fffffff;
    second = (second * 131 + code) % 0x7fffffff;
  }
  return first.toString(16).padStart(8, '0') + second.toString(16).padStart(8, '0');
};

const manifestOf = (
  tool: McpToolDescriptor,
  sensitiveResultFor?: (name: string) => ToolManifest['sensitiveResult'],
): ToolManifest => {
  const sensitiveResult = sensitiveResultFor?.(tool.name);
  return {
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    parameters: tool.inputSchema,
    ...(sensitiveResult ? { sensitiveResult } : {}),
  };
};

/**
 * Projects a real `tools/list` plus an optional v1 capability resource into the
 * MOB-094 trusted catalog.
 *
 * - `tools/list` remains the only schema/tool authority.
 * - Only locally permitted real tools are exposed as callable manifests.
 * - A capability is projected only when its access mode is locally permitted
 *   and its declared scopes are actually granted, and each capability is
 *   reduced to the exposed real tools. Projecting a write/send capability does
 *   not grant any tool that local policy did not permit.
 * - Missing/unknown/mismatched resources degrade to a flat service with no
 *   invented capability groups. Real tools are never dropped for being
 *   unclassified.
 */
export const projectMcpService = (
  options: ProjectMcpServiceOptions,
): McpServiceProjection => {
  const grantedScopes = new Set(options.grantedScopes);
  const requiredScopes = options.requiredScopes ?? [];
  if (!requiredScopes.every((scope) => grantedScopes.has(scope))) {
    throw new ServiceCapabilitiesUnsupportedError('scope');
  }
  const permittedAccess = new Set(options.permittedAccess);
  const permitted = new Set(options.permittedToolNames);
  const realTools = new Map<string, McpToolDescriptor>();
  for (const tool of options.toolDescriptors) {
    if (!permitted.has(tool.name) || realTools.has(tool.name)) continue;
    realTools.set(tool.name, tool);
  }
  const manifests = [...realTools.values()].map((tool) =>
    manifestOf(tool, options.sensitiveResultFor),
  );
  const exposedNames = new Set(manifests.map((tool) => tool.name));
  const baseService: ToolServiceDescriptor = {
    id: options.serviceId,
    name: options.serviceName,
    ...(options.serviceDescription
      ? { description: options.serviceDescription }
      : {}),
    toolNames: manifests.map((tool) => tool.name),
  };

  const flat = (
    degradation: McpServiceDegradation,
  ): McpServiceProjection => ({
    service: baseService,
    tools: manifests,
    catalogRevision: revisionHash(JSON.stringify({
      service: options.serviceId,
      schema: 'flat',
      tools: manifests.map((tool) => [tool.name, tool.parameters]),
    })),
    degradation,
  });

  if (options.capabilityResource === undefined ||
      options.capabilityResource === null) {
    return flat('no-resource');
  }

  let resource: ServiceCapabilitiesV1;
  try {
    resource = parseServiceCapabilitiesV1(options.capabilityResource);
  } catch {
    return flat('unknown-schema');
  }
  if (resource.service.id !== options.serviceId ||
      (options.serverInfo?.serverName !== null &&
        options.serverInfo?.serverName !== undefined &&
        resource.service.mcp.serverName !== options.serverInfo.serverName)) {
    return flat('identity-mismatch');
  }

  const capabilities: ToolCapabilityDescriptor[] = [];
  const grouped = new Set<string>();
  for (const capability of resource.capabilities) {
    if (!permittedAccess.has(capability.access)) continue;
    if (!capability.requiredScopes.every((scope) => grantedScopes.has(scope))) {
      continue;
    }
    const toolNames = capability.tools.filter((name) => exposedNames.has(name));
    if (toolNames.length === 0) continue;
    toolNames.forEach((name) => grouped.add(name));
    capabilities.push({
      id: capability.id,
      name: capability.title,
      description: capability.description,
      toolNames,
    });
  }

  const service: ToolServiceDescriptor = capabilities.length > 0
    ? { ...baseService, capabilities }
    : baseService;
  const unclassified = manifests.some((tool) => !grouped.has(tool.name));
  const degradation: McpServiceDegradation =
    capabilities.length === 0
      ? 'unclassified-tools'
      : unclassified ? 'unclassified-tools' : 'none';
  return {
    service,
    tools: manifests,
    catalogRevision: revisionHash(JSON.stringify({
      service: options.serviceId,
      schema: resource.schema,
      version: resource.version,
      tools: manifests.map((tool) => [tool.name, tool.parameters]),
      capabilities: capabilities.map((capability) => [
        capability.id,
        capability.toolNames,
      ]),
    })),
    degradation,
  };
};
