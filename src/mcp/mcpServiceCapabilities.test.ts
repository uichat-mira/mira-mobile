import {
  SERVICE_CAPABILITIES_SCHEMA_VERSION,
  ServiceCapabilitiesUnsupportedError,
  parseServiceCapabilitiesV1,
  projectMcpService,
} from './mcpServiceCapabilities';
import type { McpToolDescriptor } from './mcpProtocolClient';

const schema = (extra: Record<string, unknown> = {}) => ({
  type: 'object',
  properties: { query: { type: 'string' } },
  additionalProperties: false,
  ...extra,
});

const tools: McpToolDescriptor[] = [
  { name: 'fixture_read_a', description: 'A', inputSchema: schema() },
  { name: 'fixture_read_b', description: 'B', inputSchema: schema({ title: 'B' }) },
  { name: 'fixture_write_c', description: 'C', inputSchema: schema() },
  { name: 'fixture_scoped_d', description: 'D', inputSchema: schema() },
  { name: 'fixture_unclassified_e', description: 'E', inputSchema: schema() },
];

const capability = (
  id: string,
  access: 'read' | 'write' | 'send' | 'destructive',
  toolNames: string[],
  requiredScopes = ['fixture.read'],
) => ({
  id,
  title: id,
  description: id + ' description',
  access,
  requiredScopes,
  confirmation: access === 'read' ? 'none' : 'confirm-argument',
  tools: toolNames,
});

const resource = {
  schema: SERVICE_CAPABILITIES_SCHEMA_VERSION,
  version: '1.0.0',
  service: {
    id: 'fixture-svc',
    name: 'Fixture service',
    description: 'Fixture declaration',
    documentation: 'https://example.test/docs',
    mcp: {
      serverName: 'fixture-server',
      serverVersion: '1.2.3',
      sdk: '@modelcontextprotocol/server@2.4.0',
      protocolVersions: ['2025-06-18'],
    },
  },
  capabilities: [
    capability('fixture.read', 'read', ['fixture_read_a', 'fixture_read_b']),
    capability('fixture.write', 'write', ['fixture_write_c']),
    capability('fixture.other-scope', 'read', ['fixture_scoped_d'], ['fixture.write']),
    capability('fixture.missing', 'read', ['fixture_ghost']),
    capability('fixture.send', 'send', ['fixture_send_f']),
  ],
  fallback: {
    unknownSchema: 'Ignore this resource.',
    unclassifiedTools: 'Keep every tools/list entry visible.',
  },
};

const project = (overrides: Partial<Parameters<typeof projectMcpService>[0]> = {}) =>
  projectMcpService({
    serviceId: 'fixture-svc',
    serviceName: 'Fixture',
    toolDescriptors: tools,
    capabilityResource: resource,
    grantedScopes: ['fixture.read'],
    requiredScope: 'fixture.read',
    permittedToolNames: [
      'fixture_read_a',
      'fixture_read_b',
      'fixture_unclassified_e',
    ],
    serverInfo: {
      protocolVersion: '2025-06-18',
      serverName: 'fixture-server',
      serverVersion: '1.2.3',
      tools: true,
      resources: true,
    },
    ...overrides,
  });

describe('OPS-046 v1 service capability projection', () => {
  it('keeps tools/list schemas authoritative and reduces real read capabilities', () => {
    const projection = project();
    expect(projection.tools.map((tool) => tool.name)).toEqual([
      'fixture_read_a',
      'fixture_read_b',
      'fixture_unclassified_e',
    ]);
    expect(projection.tools[0].parameters).toEqual(schema());
    expect(projection.service.toolNames).toEqual([
      'fixture_read_a',
      'fixture_read_b',
      'fixture_unclassified_e',
    ]);
    expect(projection.service.capabilities).toEqual([{
      id: 'fixture.read',
      name: 'fixture.read',
      description: 'fixture.read description',
      toolNames: ['fixture_read_a', 'fixture_read_b'],
    }]);
    // write/send/other-scope/ghost capabilities never become callable.
    expect(projection.service.capabilities?.some((cap) =>
      cap.toolNames.includes('fixture_write_c'))).toBe(false);
    expect(projection.tools.map((tool) => tool.name))
      .not.toContain('fixture_scoped_d');
    expect(projection.tools.map((tool) => tool.name))
      .not.toContain('fixture_ghost');
    // The unclassified real tool stays visible instead of disappearing.
    expect(projection.degradation).toBe('unclassified-tools');
  });

  it('falls back flat when the optional resource is absent or unsupported', () => {
    for (const [input, degradation] of [
      [undefined, 'no-resource'],
      [null, 'no-resource'],
      [{ schema: 'mira.service-capabilities/v2' }, 'unknown-schema'],
      [{ ...resource, unexpected: true }, 'unknown-schema'],
      ['not json', 'unknown-schema'],
    ] as const) {
      const projection = project({ capabilityResource: input });
      expect(projection.degradation).toBe(degradation);
      expect(projection.service.capabilities).toBeUndefined();
      expect(projection.tools.map((tool) => tool.name)).toEqual([
        'fixture_read_a',
        'fixture_read_b',
        'fixture_unclassified_e',
      ]);
    }
  });

  it('rejects cross-service and server-identity mappings instead of applying them', () => {
    for (const overrides of [
      {
        capabilityResource: {
          ...resource,
          service: { ...resource.service, id: 'another-service' },
        },
      },
      {
        capabilityResource: {
          ...resource,
          service: { ...resource.service, mcp: {
            ...resource.service.mcp,
            serverName: 'another-server',
          } },
        },
      },
    ]) {
      const projection = project(overrides);
      expect(projection.degradation).toBe('identity-mismatch');
      expect(projection.service.capabilities).toBeUndefined();
    }
  });

  it('derives an opaque revision from real schemas and capability mapping', () => {
    const first = project();
    expect(project()).toEqual(first);
    const changedSchema = project({
      toolDescriptors: tools.map((tool) => tool.name === 'fixture_read_a'
        ? { ...tool, inputSchema: schema({ required: ['query'] }) }
        : tool),
    });
    expect(changedSchema.catalogRevision).not.toBe(first.catalogRevision);
    const changedGrouping = project({
      capabilityResource: {
        ...resource,
        capabilities: [
          capability('fixture.renamed', 'read', ['fixture_read_a', 'fixture_read_b']),
          ...resource.capabilities.slice(1),
        ],
      },
    });
    expect(changedGrouping.catalogRevision).not.toBe(first.catalogRevision);
  });

  it('fails closed without the required scope and never trusts declared scopes as a grant', () => {
    expect(() => project({ grantedScopes: ['fixture.write'] }))
      .toThrow(ServiceCapabilitiesUnsupportedError);
    // A read capability that declares an ungranted scope is not projected.
    const projection = project({
      capabilityResource: {
        ...resource,
        capabilities: [
          capability(
            'fixture.read',
            'read',
            ['fixture_read_a'],
            ['fixture.read', 'fixture.write'],
          ),
        ],
      },
      permittedToolNames: ['fixture_read_a'],
    });
    expect(projection.service.capabilities).toBeUndefined();
    expect(projection.tools.map((tool) => tool.name)).toEqual(['fixture_read_a']);
  });

  it('parses only the closed v1 shape and caps resource text', () => {
    expect(parseServiceCapabilitiesV1(resource).service.id).toBe('fixture-svc');
    expect(() => parseServiceCapabilitiesV1({
      ...resource,
      capabilities: [{ ...resource.capabilities[0], extra: true }],
    })).toThrow(ServiceCapabilitiesUnsupportedError);
    expect(() => parseServiceCapabilitiesV1({
      ...resource,
      capabilities: [
        resource.capabilities[0],
        { ...resource.capabilities[1], tools: ['fixture_read_a'] },
      ],
    })).toThrow(ServiceCapabilitiesUnsupportedError);
  });
});
