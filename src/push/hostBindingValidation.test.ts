import nacl from 'tweetnacl';

import {
  bytesToBase64Url,
  utf8Bytes,
} from './installationIdentity';
import {
  hostBindingDescriptorSigningValue,
} from './brokerContracts';
import { validatePushBindingDescriptor } from './hostBindingValidation';

const NOW = Date.parse('2026-10-07T00:00:00.000Z');

const createSigned = (overrides: Record<string, unknown> = {}) => {
  const host = nacl.sign.keyPair.fromSeed(
    Uint8Array.from({ length: nacl.sign.seedLength }, (_, index) => index + 7),
  );
  const unsigned = {
    schemaVersion: 1 as const,
    hostId: 'host-1',
    hostPublicKey: bytesToBase64Url(host.publicKey),
    installationId: 'mira-installation-1',
    sourceScope: ['thread-a', 'thread-b'],
    bindingNonce: 'binding-nonce',
    bindingExpiresAt: new Date(NOW + 4 * 60 * 1000).toISOString(),
    ...overrides,
  };
  const hostSignature = bytesToBase64Url(
    nacl.sign.detached(
      utf8Bytes(
        hostBindingDescriptorSigningValue({
          schemaVersion: 1,
          hostId: String(unsigned.hostId),
          hostPublicKey: String(unsigned.hostPublicKey),
          installationId: String(unsigned.installationId),
          sourceScope: unsigned.sourceScope as string[],
          bindingNonce: String(unsigned.bindingNonce),
          bindingExpiresAt: String(unsigned.bindingExpiresAt),
        }),
      ),
      host.secretKey,
    ),
  );
  return {
    brokerBaseUrl: 'https://push.example.test',
    descriptor: {
      ...unsigned,
      hostSignature,
    },
  };
};

describe('validatePushBindingDescriptor', () => {
  it('accepts the frozen #268 Host descriptor contract', () => {
    expect(
      validatePushBindingDescriptor(createSigned(), {
        installationId: 'mira-installation-1',
        requestedSourceScope: ['thread-b', 'thread-a'],
        now: NOW,
      }),
    ).toMatchObject({
      brokerBaseUrl: 'https://push.example.test',
      descriptor: {
        hostId: 'host-1',
        sourceScope: ['thread-a', 'thread-b'],
      },
    });
  });

  it('rejects a signature from another Host key', () => {
    const response = createSigned();
    response.descriptor.hostPublicKey = bytesToBase64Url(
      nacl.sign.keyPair().publicKey,
    );
    expect(() =>
      validatePushBindingDescriptor(response, {
        installationId: 'mira-installation-1',
        requestedSourceScope: ['thread-a', 'thread-b'],
        now: NOW,
      }),
    ).toThrow('signature');
  });

  it('rejects scope expansion and installation mismatch', () => {
    const expanded = createSigned({
      sourceScope: ['thread-a', 'thread-b', 'thread-c'],
    });
    expect(() =>
      validatePushBindingDescriptor(expanded, {
        installationId: 'mira-installation-1',
        requestedSourceScope: ['thread-a', 'thread-b'],
        now: NOW,
      }),
    ).toThrow('source scope');

    expect(() =>
      validatePushBindingDescriptor(createSigned(), {
        installationId: 'another-installation',
        requestedSourceScope: ['thread-a', 'thread-b'],
        now: NOW,
      }),
    ).toThrow('another installation');
  });

  it('rejects expired and overlong descriptors', () => {
    const expired = createSigned({
      bindingExpiresAt: new Date(NOW - 1).toISOString(),
    });
    expect(() =>
      validatePushBindingDescriptor(expired, {
        installationId: 'mira-installation-1',
        requestedSourceScope: ['thread-a', 'thread-b'],
        now: NOW,
      }),
    ).toThrow('TTL');

    const overlong = createSigned({
      bindingExpiresAt: new Date(NOW + 6 * 60 * 1000).toISOString(),
    });
    expect(() =>
      validatePushBindingDescriptor(overlong, {
        installationId: 'mira-installation-1',
        requestedSourceScope: ['thread-a', 'thread-b'],
        now: NOW,
      }),
    ).toThrow('TTL');
  });
});
