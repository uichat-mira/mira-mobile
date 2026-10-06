import nacl from 'tweetnacl';

import {
  MemoryPushInstallationSecureStore,
  PushInstallationIdentityService,
  bytesToBase64Url,
} from './installationIdentity';

const base64UrlToBytes = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(Buffer.from(normalized, 'base64'));
};

describe('PushInstallationIdentityService', () => {
  it('persists one stable installation identity in secure storage', async () => {
    const store = new MemoryPushInstallationSecureStore();
    const service = new PushInstallationIdentityService(
      store,
      () => new Date('2026-10-07T00:00:00.000Z'),
    );

    const first = await service.getOrCreate();
    const second = await service.getOrCreate();

    expect(second).toEqual(first);
    expect(first.installationId).toMatch(/^mira-installation-/);
    expect(base64UrlToBytes(first.installationPublicKey)).toHaveLength(
      nacl.sign.publicKeyLength,
    );
    expect(store.peek()?.seed).toBeTruthy();
  });

  it('signs the exact Broker value with the persisted Ed25519 key', async () => {
    const store = new MemoryPushInstallationSecureStore();
    const service = new PushInstallationIdentityService(store);
    const identity = await service.getOrCreate();
    const message = 'Mira Push 签名 contract';
    const signature = await service.sign(message);

    expect(
      nacl.sign.detached.verify(
        new TextEncoder().encode(message),
        base64UrlToBytes(signature),
        base64UrlToBytes(identity.installationPublicKey),
      ),
    ).toBe(true);
  });

  it('reset removes the old seed and generates a new installation identity', async () => {
    const store = new MemoryPushInstallationSecureStore();
    const service = new PushInstallationIdentityService(store);
    const first = await service.getOrCreate();

    await service.reset();
    expect(store.peek()).toBeNull();

    const second = await service.getOrCreate();
    expect(second.installationId).not.toBe(first.installationId);
    expect(second.installationPublicKey).not.toBe(first.installationPublicKey);
  });

  it('base64url encoder never leaks padding or non-url alphabet', () => {
    expect(bytesToBase64Url(Uint8Array.from([251, 255, 239]))).toMatch(
      /^[A-Za-z0-9_-]+$/,
    );
  });
});
