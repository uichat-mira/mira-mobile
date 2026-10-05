import {
  beginThreadReferenceMutationFence,
  filterUnfencedThreadReferences,
  isThreadReferenceMutationFenced,
  removeThreadReferences,
  restoreThreadReferences,
} from './threadReferenceMutationFence';

describe('threadReferenceMutationFence', () => {
  it('filters fenced session ids from hydration snapshots until released', () => {
    const release = beginThreadReferenceMutationFence(['local-a']);

    expect(isThreadReferenceMutationFenced('local-a')).toBe(true);
    expect(
      filterUnfencedThreadReferences({
        'local-a': 'stale',
        'local-b': 'keep',
      }),
    ).toEqual({ 'local-b': 'keep' });

    release();

    expect(isThreadReferenceMutationFenced('local-a')).toBe(false);
    expect(
      filterUnfencedThreadReferences({
        'local-a': 'allowed-again',
        'local-b': 'keep',
      }),
    ).toEqual({
      'local-a': 'allowed-again',
      'local-b': 'keep',
    });
  });

  it('removes and restores the exact normalized thread-id set', () => {
    const original = {
      'local-a': { value: 1 },
      'local-b': { value: 2 },
    };

    const { next, removed } = removeThreadReferences(
      original,
      [' local-a ', 'local-a', 'missing'],
    );

    expect(next).toEqual({ 'local-b': { value: 2 } });
    expect(removed).toEqual({ 'local-a': { value: 1 } });
    expect(restoreThreadReferences(next, removed)).toEqual(original);
  });
});
