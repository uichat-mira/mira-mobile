import nacl from 'tweetnacl';

import {
  bindingApprovalSigningValue,
  registrationSigningValue,
} from './brokerContracts';
import {
  MemoryPushInstallationSecureStore,
  PushInstallationIdentityService,
  base64UrlToBytes,
  utf8Bytes,
} from './installationIdentity';
import { PushBrokerClient } from './pushBrokerClient';

const verify = (
  message: string,
  signature: string,
  publicKey: string,
) =>
  nacl.sign.detached.verify(
    utf8Bytes(message),
    base64UrlToBytes(signature),
    base64UrlToBytes(publicKey),
  );

describe('PushBrokerClient', () => {
  const now = () => new Date('2026-10-07T00:00:00.000Z');

  it('registers a raw provider token only with the Broker and signs the canonical payload', async () => {
    const identity = new PushInstallationIdentityService(
      new MemoryPushInstallationSecureStore(),
      now,
    );
    const installation = await identity.getOrCreate();
    const requests: Array<{
      url: string;
      body: Record<string, unknown>;
    }> = [];
    const client = new PushBrokerClient(
      'https://push.example.test',
      identity,
      (async (input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        requests.push({ url: String(input), body });
        return new Response(
          JSON.stringify({
            installationId: installation.installationId,
            status: 'registered',
            registeredAt: now().toISOString(),
          }),
          { status: 201 },
        );
      }) as typeof fetch,
      false,
      now,
    );

    await client.registerProviderToken('android', 'raw-fcm-token');

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      `https://push.example.test/v1/installations/${installation.installationId}/register`,
    );
    expect(requests[0]?.body.providerToken).toBe('raw-fcm-token');
    const body = requests[0]!.body as {
      schemaVersion: 1;
      installationId: string;
      platform: 'android';
      providerToken: string;
      installationPublicKey: string;
      requestNonce: string;
      issuedAt: string;
      installationSignature: string;
    };
    expect(
      verify(
        registrationSigningValue('register', {
          schemaVersion: body.schemaVersion,
          installationId: body.installationId,
          platform: body.platform,
          providerToken: body.providerToken,
          installationPublicKey: body.installationPublicKey,
          requestNonce: body.requestNonce,
          issuedAt: body.issuedAt,
        }),
        body.installationSignature,
        body.installationPublicKey,
      ),
    ).toBe(true);
  });

  it('refreshes the same installation instead of creating another identity', async () => {
    const identity = new PushInstallationIdentityService(
      new MemoryPushInstallationSecureStore(),
      now,
    );
    const installation = await identity.getOrCreate();
    const urls: string[] = [];
    const client = new PushBrokerClient(
      'https://push.example.test/',
      identity,
      (async input => {
        urls.push(String(input));
        return new Response(
          JSON.stringify({
            installationId: installation.installationId,
            status: 'refreshed',
            registeredAt: now().toISOString(),
          }),
          { status: 200 },
        );
      }) as typeof fetch,
      false,
      now,
    );

    await client.refreshProviderToken('ios', 'rotated-apns-token');

    expect(urls).toEqual([
      `https://push.example.test/v1/installations/${installation.installationId}/refresh`,
    ]);
    expect((await identity.getOrCreate()).installationId).toBe(
      installation.installationId,
    );
  });

  it('approves only a descriptor targeting this installation and normalizes source scope', async () => {
    const identity = new PushInstallationIdentityService(
      new MemoryPushInstallationSecureStore(),
      now,
    );
    const installation = await identity.getOrCreate();
    let requestBody: Record<string, unknown> | null = null;
    const client = new PushBrokerClient(
      'https://push.example.test',
      identity,
      (async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            installationId: installation.installationId,
            hostId: 'host-1',
            status: 'authorized',
            deliveryToken: 'delivery-token-that-is-long-enough-for-the-contract',
          }),
          { status: 201 },
        );
      }) as typeof fetch,
      false,
      now,
    );

    await client.approveBinding({
      schemaVersion: 1,
      installationId: installation.installationId,
      hostId: 'host-1',
      hostPublicKey: 'host-public-key',
      sourceScope: ['thread-b', 'thread-a', 'thread-b'],
      bindingNonce: 'binding-nonce',
      bindingExpiresAt: '2026-10-07T00:04:00.000Z',
    });

    expect(requestBody).not.toBeNull();
    if (!requestBody) throw new Error('Broker approval request was not captured');
    const body = requestBody as unknown as {
      schemaVersion: 1;
      installationId: string;
      hostId: string;
      hostPublicKey: string;
      sourceScope: string[];
      bindingNonce: string;
      bindingExpiresAt: string;
      installationSignature: string;
    };
    expect(body.sourceScope).toEqual(['thread-a', 'thread-b']);
    expect(
      verify(
        bindingApprovalSigningValue({
          schemaVersion: body.schemaVersion,
          installationId: body.installationId,
          hostId: body.hostId,
          hostPublicKey: body.hostPublicKey,
          sourceScope: body.sourceScope,
          bindingNonce: body.bindingNonce,
          bindingExpiresAt: body.bindingExpiresAt,
        }),
        body.installationSignature,
        installation.installationPublicKey,
      ),
    ).toBe(true);
  });

  it('rejects redirects instead of forwarding signed provider credentials', async () => {
    const identity = new PushInstallationIdentityService(
      new MemoryPushInstallationSecureStore(),
      now,
    );
    const client = new PushBrokerClient(
      'https://push.example.test',
      identity,
      (async () => {
        return new Response(null, {
          status: 307,
          headers: { location: 'https://attacker.example.test/steal' },
        });
      }) as typeof fetch,
      false,
      now,
    );

    await expect(
      client.registerProviderToken('android', 'raw-fcm-token'),
    ).rejects.toMatchObject({
      name: 'PushBrokerError',
      code: 'REDIRECT_REJECTED',
      status: 307,
    });
  });

  it('rejects non-local insecure Broker URLs', () => {
    expect(
      () => new PushBrokerClient('http://push.example.test'),
    ).toThrow('requires HTTPS');
  });
});
