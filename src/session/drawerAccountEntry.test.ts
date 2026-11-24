import { projectDrawerAccountEntry } from './drawerAccountEntry';

const alice = { id: 'account-alice', username: 'alice' };

describe('drawer Cloud account entry projection', () => {
  it('shows the verified username and initial when signed in', () => {
    const entry = projectDrawerAccountEntry('signed_in', alice);

    expect(entry).toMatchObject({
      kind: 'identity',
      initial: 'A',
      accountName: 'alice',
      label: 'alice',
      detail: null,
      tone: 'default',
    });
    expect(entry.accessibilityLabel).toContain('alice');
  });

  it('uses the first character of a non-Latin username without inventing an avatar', () => {
    const entry = projectDrawerAccountEntry('signed_in', {
      id: 'account-cn',
      username: '小明',
    });

    expect(entry.initial).toBe('小');
    expect(entry.accountName).toBe('小明');
    expect(entry.detail).toBeNull();
  });

  it('keeps a trusted identity during a Cloud outage but names the interruption', () => {
    const entry = projectDrawerAccountEntry('cloud_unavailable', alice);

    expect(entry).toMatchObject({
      kind: 'identity_unavailable',
      initial: 'A',
      accountName: 'alice',
      label: 'alice',
      detail: 'Cloud 连接中断',
      tone: 'warning',
    });
    expect(entry.accessibilityLabel).toContain('连接中断');
  });

  it('does not present an outage as signed out when the store has no identity', () => {
    const entry = projectDrawerAccountEntry('cloud_unavailable', null);

    expect(entry).toMatchObject({
      kind: 'signed_out',
      initial: null,
      accountName: null,
      label: '未登录',
      detail: 'Cloud 暂时不可用',
    });
  });

  it('shows a neutral signed-out entry with no identity placeholder', () => {
    const entry = projectDrawerAccountEntry('signed_out', null);

    expect(entry).toMatchObject({
      kind: 'signed_out',
      initial: null,
      accountName: null,
      label: '未登录',
      detail: null,
    });
    expect(entry.accessibilityLabel).toContain('未登录');
  });

  it('never flashes a default identity while the store is still loading', () => {
    const entry = projectDrawerAccountEntry('loading', null);

    expect(entry).toMatchObject({
      kind: 'pending',
      initial: null,
      accountName: null,
      label: '检查中',
    });
  });

  it('reports browser authorization without a fake account', () => {
    const entry = projectDrawerAccountEntry('authorizing', null);

    expect(entry).toMatchObject({
      kind: 'pending',
      initial: null,
      accountName: null,
      label: '登录中',
    });
  });

  it('drops a stale identity when the session is rejected', () => {
    const entry = projectDrawerAccountEntry('session_rejected', alice);

    expect(entry).toMatchObject({
      kind: 'attention',
      initial: null,
      accountName: null,
      label: '登录已失效',
      detail: '重新登录',
      tone: 'error',
    });
    expect(entry.accessibilityLabel).not.toContain('alice');
  });

  it('drops a stale identity when the device authorization is revoked', () => {
    const entry = projectDrawerAccountEntry('device_revoked', alice);

    expect(entry).toMatchObject({
      kind: 'attention',
      initial: null,
      accountName: null,
      label: '授权已撤销',
      detail: '重新注册',
      tone: 'error',
    });
    expect(entry.accessibilityLabel).not.toContain('alice');
  });

  it('drops a stale identity after sign-out instead of leaking the last account', () => {
    const entry = projectDrawerAccountEntry('signed_out', alice);

    expect(entry.accountName).toBeNull();
    expect(entry.initial).toBeNull();
    expect(entry.accessibilityLabel).not.toContain('alice');
  });

  it('treats signed-in without a trusted account as unauthenticated', () => {
    const entry = projectDrawerAccountEntry('signed_in', null);

    expect(entry).toMatchObject({
      kind: 'signed_out',
      initial: null,
      accountName: null,
      label: '未登录',
    });
  });

  it('immediately reflects an account switch', () => {
    const first = projectDrawerAccountEntry('signed_in', alice);
    const next = projectDrawerAccountEntry('signed_in', {
      id: 'account-bob',
      username: 'bob',
    });

    expect(first.label).toBe('alice');
    expect(next.label).toBe('bob');
    expect(next.initial).toBe('B');
  });
});
