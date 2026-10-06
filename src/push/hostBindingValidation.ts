import nacl from 'tweetnacl';

import {
  hostBindingDescriptorSigningValue,
  normalizePushSourceScope,
} from './brokerContracts';
import {
  base64UrlToBytes,
  utf8Bytes,
} from './installationIdentity';
import type {
  RemotePushBindingDescriptorResponse,
} from '../api/remoteMiraHost';

const HOST_BINDING_MAX_TTL_MS = 5 * 60 * 1000;

export interface ValidatedPushBindingDescriptor {
  brokerBaseUrl: string;
  descriptor: RemotePushBindingDescriptorResponse['descriptor'];
}

const sameStrings = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

export const validatePushBindingDescriptor = (
  response: RemotePushBindingDescriptorResponse,
  input: {
    installationId: string;
    requestedSourceScope: string[];
    now?: number;
  },
): ValidatedPushBindingDescriptor => {
  const now = input.now ?? Date.now();
  const descriptor = response.descriptor;
  const expectedScope = normalizePushSourceScope(input.requestedSourceScope);
  const actualScope = normalizePushSourceScope(descriptor.sourceScope);
  const expiresAt = Date.parse(descriptor.bindingExpiresAt);

  if (descriptor.schemaVersion !== 1) {
    throw new Error('Unsupported Push binding descriptor version');
  }
  if (descriptor.installationId !== input.installationId) {
    throw new Error('Push binding descriptor targets another installation');
  }
  if (!descriptor.hostId.trim() || !descriptor.bindingNonce.trim()) {
    throw new Error('Push binding descriptor identity is incomplete');
  }
  if (!sameStrings(actualScope, expectedScope)) {
    throw new Error('Push binding descriptor source scope does not match the request');
  }
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    expiresAt > now + HOST_BINDING_MAX_TTL_MS
  ) {
    throw new Error('Push binding descriptor is expired or has an invalid TTL');
  }

  const hostPublicKey = base64UrlToBytes(descriptor.hostPublicKey);
  const hostSignature = base64UrlToBytes(descriptor.hostSignature);
  if (
    hostPublicKey.length !== nacl.sign.publicKeyLength ||
    hostSignature.length !== nacl.sign.signatureLength
  ) {
    throw new Error('Push binding descriptor Host signature material is invalid');
  }

  const valid = nacl.sign.detached.verify(
    utf8Bytes(
      hostBindingDescriptorSigningValue({
        schemaVersion: 1,
        hostId: descriptor.hostId,
        hostPublicKey: descriptor.hostPublicKey,
        installationId: descriptor.installationId,
        sourceScope: actualScope,
        bindingNonce: descriptor.bindingNonce,
        bindingExpiresAt: descriptor.bindingExpiresAt,
      }),
    ),
    hostSignature,
    hostPublicKey,
  );
  if (!valid) {
    throw new Error('Push binding descriptor Host signature is invalid');
  }

  return {
    brokerBaseUrl: response.brokerBaseUrl,
    descriptor: {
      ...descriptor,
      sourceScope: actualScope,
    },
  };
};
