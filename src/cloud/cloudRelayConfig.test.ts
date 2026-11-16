import { officialCloudRelayEndpoint } from './cloudRelayConfig';

describe('MOB-080 operator-managed Cloud Relay endpoint', () => {
  it('ships official Cloud-only service for dev, never unpromoted channels', () => {
    expect(officialCloudRelayEndpoint('dev')).toBe(
      'https://cloud-relay.tomz.io',
    );
    expect(officialCloudRelayEndpoint('test')).toBeNull();
    expect(officialCloudRelayEndpoint('predev')).toBeNull();
    expect(officialCloudRelayEndpoint('prod')).toBeNull();
  });
});
