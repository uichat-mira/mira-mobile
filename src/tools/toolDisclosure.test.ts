import {
  ToolGatewayError,
  TOOL_DISCLOSURE_TOOL,
  type ToolManifest,
  type ToolServiceDescriptor,
} from './toolGatewayClient';
import {
  mergeDisclosedTools,
  parseToolDisclosureArguments,
  resolveToolDisclosureTarget,
  toolDisclosureManifest,
  toolServiceContext,
  validateToolServiceCatalog,
} from './toolDisclosure';

const tool = (
  name: string,
  parameters: Record<string, unknown> = { type: 'object' },
): ToolManifest => ({ name, parameters });

const expectErrorCode = (fn: () => unknown, code: string): void => {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({ name: 'ToolGatewayError', code });
};

const service = (
  overrides: Partial<ToolServiceDescriptor> = {},
): ToolServiceDescriptor => ({
  id: 'svc-a',
  name: 'Service A',
  description: 'Trusted service A',
  toolNames: ['tool_a', 'tool_b'],
  ...overrides,
});

describe('tool service catalog', () => {
  it('treats a service without capabilities as a flat real-tool catalog', () => {
    const flat = service({ capabilities: undefined });
    const text = toolServiceContext([flat]);
    const manifest = toolDisclosureManifest([flat]);

    expect(text).toContain('no semantic capability groups declared');
    expect(text).toContain('tool_a, tool_b');
    expect(text).not.toContain('capabilityId=');
    expect(manifest.name).toBe(TOOL_DISCLOSURE_TOOL);
    expect(manifest.description).toContain('no semantic capability groups declared');
  });

  it('maps capability tool names to their real service/capability owner', () => {
    const owners = validateToolServiceCatalog([
      service({
        capabilities: [
          { id: 'search', name: 'Search', toolNames: ['tool_a'] },
          { id: 'fetch', name: 'Fetch', toolNames: ['tool_b'] },
        ],
      }),
    ], [tool('tool_a'), tool('tool_b')]);

    expect(owners.get('tool_a')).toEqual({ serviceId: 'svc-a', capabilityId: 'search' });
    expect(owners.get('tool_b')).toEqual({ serviceId: 'svc-a', capabilityId: 'fetch' });
  });

  it.each([
    [
      'a duplicate tool name across services',
      [service(), service({ id: 'svc-b' })],
      [tool('tool_a'), tool('tool_b')],
    ],
    [
      'a capability referencing an undeclared tool',
      [service({
        capabilities: [{ id: 'search', name: 'Search', toolNames: ['ghost'] }],
      })],
      [tool('tool_a'), tool('tool_b')],
    ],
    [
      'a disclosed tool with no service mapping',
      [service()],
      [tool('tool_a'), tool('tool_b'), tool('ghost')],
    ],
  ])('rejects %s instead of inventing a mapping', (_label, services, manifests) => {
    expect(() => validateToolServiceCatalog(services, manifests))
      .toThrow(ToolGatewayError);
  });

  it('only discloses names declared by the selected service or capability', () => {
    const services = [service({
      capabilities: [
        { id: 'search', name: 'Search', toolNames: ['tool_a'] },
        { id: 'fetch', name: 'Fetch', toolNames: ['tool_b'] },
      ],
    })];

    expect(resolveToolDisclosureTarget(services, {
      serviceId: 'svc-a',
      capabilityId: 'search',
    })).toEqual({
      serviceId: 'svc-a',
      capabilityId: 'search',
      toolNames: ['tool_a'],
    });
    expect(() => resolveToolDisclosureTarget(services, {
      serviceId: 'svc-a',
      capabilityId: 'search',
      toolNames: ['tool_b'],
    })).toThrow(ToolGatewayError);
    expectErrorCode(() => resolveToolDisclosureTarget(services, {
      serviceId: 'svc-a',
      capabilityId: 'search',
      toolNames: ['tool_b'],
    }), 'TOOL_DISCLOSURE_DENIED');
  });

  it('rejects disclosure results outside the requested target and schema swaps', () => {
    const services = [service({
      capabilities: [{ id: 'search', name: 'Search', toolNames: ['tool_a'] }],
    })];
    const target = {
      serviceId: 'svc-a',
      capabilityId: 'search',
      toolNames: ['tool_a'] as const,
    };
    expect(mergeDisclosedTools({
      current: [],
      services,
      target,
      incoming: [tool('tool_a')],
    })).toEqual([tool('tool_a')]);
    expectErrorCode(() => mergeDisclosedTools({
      current: [],
      services,
      target,
      incoming: [tool('tool_b')],
    }), 'TOOL_DISCLOSURE_DENIED');

    expectErrorCode(() => mergeDisclosedTools({
      current: [tool('tool_a')],
      services,
      target,
      incoming: [tool('tool_a', {
        type: 'object',
        properties: { unexpected: { type: 'string' } },
      })],
    }), 'TOOL_SCHEMA_CONFLICT');
  });

  it('parses model arguments as data only and rejects extra fields', () => {
    expect(parseToolDisclosureArguments({
      serviceId: 'svc-a',
      capabilityId: 'search',
      toolNames: ['tool_a'],
    })).toEqual({
      serviceId: 'svc-a',
      capabilityId: 'search',
      toolNames: ['tool_a'],
    });
    expectErrorCode(() => parseToolDisclosureArguments({
      serviceId: 'svc-a',
      arguments: 'call everything',
    }), 'TOOL_DISCLOSURE_INVALID');
  });
});
