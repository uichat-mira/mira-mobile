import { resolveRemoteCreateSource } from './resolveRemoteCreateSource';

describe('new chat remote-source choice', () => {
  it('keeps the explicit Cloud selection when signed in', () => {
    expect(resolveRemoteCreateSource('cloud-host', true)).toBe('cloud-host');
  });
  it('keeps explicit paired selection even with a stored Cloud session', () => {
    expect(resolveRemoteCreateSource('remote-host', true)).toBe('remote-host');
  });
  it('uses Cloud as the default remote entry when the Cloud account is active', () => {
    expect(resolveRemoteCreateSource('all', true)).toBe('cloud-host');
    expect(resolveRemoteCreateSource('local-provider', true)).toBe('cloud-host');
  });
  it('falls back to the independent paired entry when Cloud is signed out', () => {
    expect(resolveRemoteCreateSource('all', false)).toBe('remote-host');
  });
});
