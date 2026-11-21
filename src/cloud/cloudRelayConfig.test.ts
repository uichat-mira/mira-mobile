import {
  officialCloudRelayEndpoint,
  normalizeCloudRelayBaseUrl,
  resolveCloudRelayBaseUrl,
} from './cloudRelayConfig';

describe('MOB-084 official Cloud-only Relay configuration', () => {
  it('ships the approved shared Relay in release builds, not a dev-only endpoint', () => {
    expect(officialCloudRelayEndpoint()).toBe('https://cloud-relay.tomz.io');
    expect(officialCloudRelayEndpoint()).not.toBe('https://relay.tomz.io');
  });

  it('still fails closed instead of using Legacy Relay when no endpoint is available', () => {
    expect(() => resolveCloudRelayBaseUrl(null)).toThrow(
      'Official Mira Cloud Relay service is not available in this build',
    );
    expect(() => normalizeCloudRelayBaseUrl('http://relay.tomz.io')).toThrow(
      'Mira Cloud Relay must use HTTPS',
    );
    expect(() =>
      normalizeCloudRelayBaseUrl('https://cloud-relay.tomz.io/path'),
    ).toThrow('Mira Cloud Relay URL must be a base URL');
  });
});
