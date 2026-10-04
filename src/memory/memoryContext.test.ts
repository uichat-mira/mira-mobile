import { buildMemoryContext } from './memoryContext';
import type { MemoryContextSnapshot } from './types';

const snapshot = (content: string): MemoryContextSnapshot => ({
  content,
  updatedAt: content ? '2026-10-04T00:00:00.000Z' : null,
  recordCount: content ? content.split('\n').length : 0,
});

describe('buildMemoryContext', () => {
  it('returns null for an empty snapshot so no noisy prompt is injected', () => {
    expect(buildMemoryContext(snapshot(''))).toBeNull();
    expect(buildMemoryContext(snapshot('   '))).toBeNull();
  });

  it('wraps memory content in an explicit memory instruction', () => {
    const context = buildMemoryContext(
      snapshot('- [偏好] 用户偏好先看结论。'),
    );

    expect(context).not.toBeNull();
    expect(context).toContain('durable memory');
    expect(context).toContain('- [偏好] 用户偏好先看结论。');
  });

  it('always carries a precedence note so the current user message can correct memory', () => {
    const context = buildMemoryContext(snapshot('- [事实] 用户住在北京。'));

    expect(context).toContain('follow the current user message');
  });
});
