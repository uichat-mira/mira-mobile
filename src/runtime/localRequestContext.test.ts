import type { ChatMessage } from '../types';
import type { PersonalizationSettings } from '../settings/personalizationSettings';
import type { MemoryContextSnapshot } from '../memory';
import type { LocalMemoryService } from '../memory';
import { assembleLocalRequestContext } from './localRequestContext';

// #227 request context assembly contract: canonical history plus the two
// Local-only system contexts, in a fixed order, with best-effort degradation.

const history: ChatMessage[] = [
  { id: 'u1', role: 'user', content: '你好', timestamp: new Date() },
  { id: 'a1', role: 'assistant', content: '你好呀', timestamp: new Date() },
];

const personalization = (): PersonalizationSettings => ({
  baseStyle: { tone: 'professional' },
  characteristics: { warmth: false, traits: [], conciseFirst: false },
  instructions: '',
});

const memoryService = (snapshot: MemoryContextSnapshot | (() => Promise<never>)): LocalMemoryService =>
  ({
    buildContext: async () => {
      if (typeof snapshot === 'function') return snapshot();
      return snapshot;
    },
  } as unknown as LocalMemoryService);

const snapshot = (content: string): MemoryContextSnapshot =>
  ({ content } as MemoryContextSnapshot);

describe('#227 assembleLocalRequestContext', () => {
  it('orders Personalization before Memory before the conversation history', async () => {
    const result = await assembleLocalRequestContext(history, {
      loadPersonalization: async () => personalization(),
      memoryService: memoryService(snapshot('用户偏好先给结论。')),
    });

    const roles = result.messages.map((message) => message.role);
    expect(roles).toEqual(['system', 'system', 'user', 'assistant']);
    expect(result.messages[0].content).toContain('professional');
    expect(result.messages[1].content).toContain('用户偏好先给结论。');
    expect(result.messages.at(-1)?.content).toBe('你好呀');
    expect(result.personalizationContext).not.toBeNull();
    expect(result.memoryContext).not.toBeNull();
  });

  it('does not mutate the canonical history array', async () => {
    const before = history.map((message) => ({ ...message }));
    await assembleLocalRequestContext(history, {
      loadPersonalization: async () => personalization(),
      memoryService: memoryService(snapshot('memory')),
    });
    expect(history).toEqual(before);
  });

  it('degrades to no Personalization context when loading fails', async () => {
    const result = await assembleLocalRequestContext(history, {
      loadPersonalization: async () => {
        throw new Error('corrupted');
      },
      memoryService: memoryService(snapshot('memory')),
    });

    expect(result.personalizationContext).toBeNull();
    expect(result.messages[0].content).toContain('memory');
  });

  it('degrades to no Memory context when the memory read fails', async () => {
    const result = await assembleLocalRequestContext(history, {
      loadPersonalization: async () => personalization(),
      memoryService: memoryService(() => Promise.reject(new Error('unavailable'))),
    });

    expect(result.memoryContext).toBeNull();
    expect(result.messages).toHaveLength(3);
  });

  it('omits both system contexts when neither carries signal', async () => {
    const result = await assembleLocalRequestContext(history, {
      loadPersonalization: async () => ({
        baseStyle: { tone: 'default' },
        characteristics: { warmth: false, traits: [], conciseFirst: false },
        instructions: '',
      }),
      memoryService: memoryService(snapshot('   ')),
    });

    expect(result.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  });
});
