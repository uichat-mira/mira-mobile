import { officialCloudRelayEndpoint } from './cloudRelayConfig';

describe('MOB-080 operator-managed Cloud Relay endpoint', () => {
  it('only ships approved isolated Worker for dev pilot, never prod/test/predev', () => {
    expect(officialCloudRelayEndpoint('dev')).toBe(
      'https://uichat-mira-relay-cloud-rel005.dangjingtao.workers.dev',
    );
    expect(officialCloudRelayEndpoint('test')).toBeNull();
    expect(officialCloudRelayEndpoint('predev')).toBeNull();
    expect(officialCloudRelayEndpoint('prod')).toBeNull();
  });
});
