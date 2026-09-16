import {
  parseRemoteMemoryOverview,
  parseRemoteMemoryRecord,
} from './remoteHostV1';

describe('remoteHostV1 memory parsers', () => {
  it('parses a full memory overview with one record of each kind', () => {
    const overview = parseRemoteMemoryOverview({
      enabled: true,
      records: [
        {
          id: 'm-1',
          kind: 'preference',
          content: '用户偏好 Markdown',
          origin: 'manual',
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
        {
          id: 'm-2',
          kind: 'fact',
          content: '用户在 2026 年加入项目',
          origin: 'conversation',
          createdAt: '2026-09-02T00:00:00.000Z',
          updatedAt: '2026-09-02T00:00:00.000Z',
        },
      ],
    });

    expect(overview.enabled).toBe(true);
    expect(overview.records).toHaveLength(2);
    expect(overview.records[0].kind).toBe('preference');
    expect(overview.records[1].origin).toBe('conversation');
  });

  it('accepts an empty record list', () => {
    const overview = parseRemoteMemoryOverview({
      enabled: false,
      records: [],
    });
    expect(overview.records).toEqual([]);
  });

  it('rejects unknown kind', () => {
    expect(() =>
      parseRemoteMemoryRecord({
        id: 'x',
        kind: 'mood',
        content: 'good',
        origin: 'manual',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      }),
    ).toThrow(/Unexpected memory record kind/);
  });

  it('rejects unknown origin', () => {
    expect(() =>
      parseRemoteMemoryRecord({
        id: 'x',
        kind: 'preference',
        content: 'good',
        origin: 'inferred',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      }),
    ).toThrow(/Unexpected memory record origin/);
  });

  it('requires enabled to be a boolean', () => {
    expect(() =>
      parseRemoteMemoryOverview({ enabled: 'yes', records: [] }),
    ).toThrow(/memoryOverview.enabled/);
  });
});