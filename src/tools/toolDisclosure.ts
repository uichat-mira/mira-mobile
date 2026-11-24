import {
  TOOL_DISCLOSURE_TOOL,
  ToolGatewayError,
  type ToolCapabilityDescriptor,
  type ToolDisclosureRequest,
  type ToolManifest,
  type ToolServiceDescriptor,
} from './toolGatewayClient';

export interface ToolOwnership {
  serviceId: string;
  capabilityId?: string;
}

export interface ResolvedToolDisclosure {
  serviceId: string;
  capabilityId?: string;
  toolNames: readonly string[];
}

const invalid = (code: string, message: string): never => {
  throw new ToolGatewayError(code, message);
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const compact = (value: string, limit: number): string => {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length > limit
    ? normalized.slice(0, limit - 1) + '…'
    : normalized;
};

const toolNamesSummary = (names: readonly string[]): string => {
  const shown = names.slice(0, 24).map(name => compact(name, 64));
  return shown.join(', ') + (names.length > shown.length ? ` 等 ${names.length} 项` : '');
};

/**
 * Validates a trusted adapter catalog and maps each real tool name to exactly
 * one service/capability owner. Flat services with no capabilities remain valid
 * and are represented as a service without invented semantic groups.
 */
export const validateToolServiceCatalog = (
  services: readonly ToolServiceDescriptor[],
  manifests: readonly ToolManifest[],
): ReadonlyMap<string, ToolOwnership> => {
  const serviceIds = new Set<string>();
  const owners = new Map<string, ToolOwnership>();

  const claim = (name: string, owner: ToolOwnership): void => {
    const existing = owners.get(name);
    if (existing) {
      invalid(
        'TOOL_NAME_COLLISION',
        `Tool ${name} is declared by more than one service/capability`,
      );
    }
    owners.set(name, owner);
  };

  for (const service of services) {
    if (!isNonEmptyString(service.id) || serviceIds.has(service.id)) {
      invalid(
        'TOOL_SERVICE_INVALID',
        `Tool service id is missing or duplicated: ${service.id}`,
      );
    }
    serviceIds.add(service.id);

    const declared = new Set<string>();
    for (const name of service.toolNames) {
      if (name === TOOL_DISCLOSURE_TOOL) {
        invalid(
          'TOOL_NAME_COLLISION',
          'A service tool collides with the Mobile disclosure entry',
        );
      }
      if (!isNonEmptyString(name) || declared.has(name)) {
        invalid(
          'TOOL_SERVICE_INVALID',
          `Tool service ${service.id} declares an empty or duplicate tool name`,
        );
      }
      declared.add(name);
    }

    const capabilityIds = new Set<string>();
    for (const capability of service.capabilities ?? []) {
      if (!isNonEmptyString(capability.id) || capabilityIds.has(capability.id)) {
        invalid(
          'TOOL_CAPABILITY_INVALID',
          `Capability id is missing or duplicated in service ${service.id}`,
        );
      }
      capabilityIds.add(capability.id);
      for (const name of capability.toolNames) {
        if (!declared.has(name)) {
          invalid(
            'TOOL_CAPABILITY_INVALID',
            `Capability ${service.id}/${capability.id} references undeclared tool ${name}`,
          );
        }
        claim(name, {
          serviceId: service.id,
          capabilityId: capability.id,
        });
      }
    }

    for (const name of service.toolNames) {
      const existing = owners.get(name);
      if (!existing) {
        claim(name, { serviceId: service.id });
      } else if (existing.serviceId !== service.id) {
        invalid(
          'TOOL_NAME_COLLISION',
          `Tool ${name} is declared by more than one service`,
        );
      }
    }
  }

  if (services.length > 0) {
    for (const manifest of manifests) {
      if (manifest.name === TOOL_DISCLOSURE_TOOL) continue;
      if (!owners.has(manifest.name)) {
        invalid(
          'TOOL_SERVICE_UNMAPPED',
          `Disclosed tool ${manifest.name} is not declared by any trusted service`,
        );
      }
    }
  }

  return owners;
};

export const parseToolDisclosureArguments = (
  value: unknown,
): ToolDisclosureRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('TOOL_DISCLOSURE_INVALID', 'Tool disclosure arguments must be an object');
  }
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (key !== 'serviceId' && key !== 'capabilityId' && key !== 'toolNames' &&
        key !== 'catalogRevision') {
      return invalid(
        'TOOL_DISCLOSURE_INVALID',
        `Unsupported tool disclosure argument: ${key}`,
      );
    }
  }
  if (!isNonEmptyString(input.serviceId) || input.serviceId.length > 160) {
    return invalid('TOOL_DISCLOSURE_INVALID', 'A valid serviceId is required');
  }
  if (input.capabilityId !== undefined &&
      (!isNonEmptyString(input.capabilityId) || input.capabilityId.length > 160)) {
    return invalid('TOOL_DISCLOSURE_INVALID', 'capabilityId must be a non-empty string');
  }
  if (input.catalogRevision !== undefined && typeof input.catalogRevision !== 'string') {
    return invalid('TOOL_DISCLOSURE_INVALID', 'catalogRevision must be a string');
  }
  let toolNames: string[] | undefined;
  if (input.toolNames !== undefined) {
    if (!Array.isArray(input.toolNames) || input.toolNames.length > 32) {
      return invalid(
        'TOOL_DISCLOSURE_INVALID',
        'toolNames must be an array of at most 32 names',
      );
    }
    toolNames = input.toolNames.map((name) => {
      if (!isNonEmptyString(name) || name.length > 160) {
        return invalid('TOOL_DISCLOSURE_INVALID', 'toolNames contains an invalid name');
      }
      return name;
    });
  }
  return {
    serviceId: input.serviceId,
    ...(input.capabilityId !== undefined ? { capabilityId: input.capabilityId } : {}),
    ...(toolNames && toolNames.length > 0 ? { toolNames } : {}),
    ...(input.catalogRevision !== undefined
      ? { catalogRevision: input.catalogRevision }
      : {}),
  };
};

export const resolveToolDisclosureTarget = (
  services: readonly ToolServiceDescriptor[],
  request: ToolDisclosureRequest,
): ResolvedToolDisclosure => {
  const service = services.find(item => item.id === request.serviceId);
  if (!service) {
    return invalid(
      'TOOL_SERVICE_NOT_AVAILABLE',
      `Trusted tool service is not available: ${request.serviceId}`,
    );
  }
  let capability: ToolCapabilityDescriptor | undefined;
  if (request.capabilityId !== undefined) {
    capability = (service.capabilities ?? []).find(
      item => item.id === request.capabilityId,
    );
    if (!capability) {
      return invalid(
        'TOOL_CAPABILITY_NOT_AVAILABLE',
        `Capability is not available: ${request.serviceId}/${request.capabilityId}`,
      );
    }
  }
  const allowed = capability?.toolNames ?? service.toolNames;
  const requested = request.toolNames && request.toolNames.length > 0
    ? request.toolNames
    : allowed;
  const unique = new Set(requested);
  if (unique.size !== requested.length) {
    return invalid('TOOL_DISCLOSURE_INVALID', 'Duplicate tool names in disclosure request');
  }
  for (const name of requested) {
    if (!allowed.includes(name)) {
      return invalid(
        'TOOL_DISCLOSURE_DENIED',
        `Tool ${name} is not declared by the selected service/capability`,
      );
    }
  }
  return {
    serviceId: service.id,
    ...(capability ? { capabilityId: capability.id } : {}),
    toolNames: requested,
  };
};

/**
 * Merges only schemas that the selected trusted service/capability declared.
 * An external tool result or model text cannot introduce a new callable name.
 */
export const mergeDisclosedTools = (options: {
  current: readonly ToolManifest[];
  services: readonly ToolServiceDescriptor[];
  target: ResolvedToolDisclosure;
  incoming: readonly ToolManifest[];
}): readonly ToolManifest[] => {
  const { current, services, target, incoming } = options;
  const incomingNames = new Set<string>();
  for (const tool of incoming) {
    if (incomingNames.has(tool.name)) {
      return invalid(
        'TOOL_DISCLOSURE_INVALID',
        `Disclosure returned a duplicate tool: ${tool.name}`,
      );
    }
    incomingNames.add(tool.name);
    if (!target.toolNames.includes(tool.name)) {
      return invalid(
        'TOOL_DISCLOSURE_DENIED',
        `Disclosure returned a tool outside the selected target: ${tool.name}`,
      );
    }
  }

  const owners = validateToolServiceCatalog(
    services,
    [...current, ...incoming],
  );
  for (const tool of incoming) {
    const owner = owners.get(tool.name);
    if (!owner ||
        owner.serviceId !== target.serviceId ||
        owner.capabilityId !== target.capabilityId) {
      return invalid(
        'TOOL_DISCLOSURE_DENIED',
        `Disclosure returned a tool outside the selected target: ${tool.name}`,
      );
    }
  }

  const byName = new Map(current.map(tool => [tool.name, tool]));
  const merged = [...current];
  for (const tool of incoming) {
    const existing = byName.get(tool.name);
    if (existing) {
      if (JSON.stringify(existing.parameters) !== JSON.stringify(tool.parameters)) {
        return invalid(
          'TOOL_SCHEMA_CONFLICT',
          `Disclosure changed the schema of an already disclosed tool: ${tool.name}`,
        );
      }
      continue;
    }
    byName.set(tool.name, tool);
    merged.push(tool);
  }
  return merged;
};

export const toolDisclosureManifest = (
  services: readonly ToolServiceDescriptor[],
): ToolManifest => ({
  name: TOOL_DISCLOSURE_TOOL,
  description: [
    'Load real tool definitions from a trusted service when the task needs them.',
    'This only reveals declared schemas; it does not execute a tool, grant access or replace approval.',
    'Already available tools can be called directly without this step. More than one tool can be disclosed at once and reused for the rest of this run.',
    'Trusted service catalog:',
    ...serviceCatalogLines(services),
  ].join('\n'),
  parameters: {
    type: 'object',
    properties: {
      serviceId: { type: 'string' },
      capabilityId: { type: 'string' },
      toolNames: { type: 'array', items: { type: 'string' } },
    },
    required: ['serviceId'],
    additionalProperties: false,
  },
});

const serviceCatalogLines = (
  services: readonly ToolServiceDescriptor[],
): string[] =>
  services.flatMap((service) => {
    const lines = [
      `- serviceId=${service.id} (${compact(service.name, 80)})` +
        (service.description ? `: ${compact(service.description, 240)}` : ''),
    ];
    const capabilities = service.capabilities ?? [];
    if (capabilities.length === 0) {
      lines.push(
        `  no semantic capability groups declared; real tools: ${toolNamesSummary(service.toolNames)}`,
      );
      return lines;
    }
    for (const capability of capabilities) {
      lines.push(
        `  capabilityId=${capability.id} (${compact(capability.name, 80)})` +
          (capability.description ? `: ${compact(capability.description, 200)}` : '') +
          `; real tools: ${toolNamesSummary(capability.toolNames)}`,
      );
    }
    return lines;
  });

/**
 * Bounded model-visible service catalog. Descriptions come only from the
 * authenticated adapter; absent capabilities are stated instead of invented.
 */
export const toolServiceContext = (
  services: readonly ToolServiceDescriptor[],
): string => [
  'Trusted tool services for this run (provided by the authenticated Tool Gateway/Adapter):',
  ...serviceCatalogLines(services),
  'This catalog controls visibility only. Every actual call still rechecks gateway authority and approval.',
  'Skip discovery for tools already available; disclose one or more declared schemas only when a task needs them.',
].join('\n');
