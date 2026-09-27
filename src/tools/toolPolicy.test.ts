import { limitToolResult, ToolPolicyError, validateToolCall } from './toolPolicy';

const manifest = [{ name: 'search', parameters: { type: 'object' } }];

describe('tool policy', () => {
  it('allows a manifest tool with object arguments', () => {
    expect(validateToolCall(manifest, { callId: '1', name: 'search', arguments: '{}' })).toEqual(manifest[0]);
  });

  it('rejects unknown tools and malformed arguments', () => {
    expect(() => validateToolCall(manifest, { callId: '1', name: 'shell', arguments: '{}' })).toThrow(ToolPolicyError);
    expect(() => validateToolCall(manifest, { callId: '1', name: 'search', arguments: '[]' })).toThrow(ToolPolicyError);
  });

  it('limits oversized tool results', () => {
    expect(limitToolResult('abcdef', 3)).toBe('abc');
  });
});
