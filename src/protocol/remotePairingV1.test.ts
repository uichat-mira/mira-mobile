import { parsePairingUriV1 } from './remotePairingV1';

const host = 'https://desktop.example.ts.net';
const relayEndpoint = 'https://relay.tomz.io';
const relayId = 'relay_1234567890abcdef';
const relayToken = 't'.repeat(43);

describe('parsePairingUriV1', () => {
  it('accepts a host-only Tailscale Direct pairing link', () => {
    const parsed = parsePairingUriV1(
      `mira://pair?version=1&challenge=challenge-1&code=abcd2345&host=${encodeURIComponent(
        host,
      )}`,
    );

    expect(parsed).toEqual({
      version: 1,
      hostUrl: host,
      challengeId: 'challenge-1',
      code: 'ABCD2345',
    });
  });

  it('keeps a Direct link usable while ignoring historical Relay hints', () => {
    const parsed = parsePairingUriV1(
      `mira://pair?version=1&challenge=challenge-1&code=ABCD2345&host=${encodeURIComponent(
        host,
      )}&relay=${encodeURIComponent(relayEndpoint)}&relayId=${relayId}`,
    );

    expect(parsed).toEqual({
      version: 1,
      hostUrl: host,
      challengeId: 'challenge-1',
      code: 'ABCD2345',
    });
  });

  it('does not let a historical Relay token enter the pairing descriptor', () => {
    const parsed = parsePairingUriV1(
      `mira://pair?version=1&challenge=challenge-1&code=ABCD2345&host=${encodeURIComponent(
        host,
      )}&relay=${encodeURIComponent(relayEndpoint)}&relayId=${relayId}&relayToken=${relayToken}`,
    );

    expect(parsed).toEqual({
      version: 1,
      hostUrl: host,
      challengeId: 'challenge-1',
      code: 'ABCD2345',
    });
    expect(parsed).not.toHaveProperty('relay');
    expect(parsed).not.toHaveProperty('relayHint');
  });

  it('rejects Relay-only pairing links because the QR entry is Direct-only', () => {
    expect(() =>
      parsePairingUriV1(
        `mira://pair?version=1&challenge=challenge-1&code=ABCD2345&relay=${encodeURIComponent(
          relayEndpoint,
        )}&relayId=${relayId}&relayToken=${relayToken}`,
      ),
    ).toThrow('must include a Tailscale Direct Host address');
  });

  it('rejects a Relay-only hint even without transport access', () => {
    expect(() =>
      parsePairingUriV1(
        `mira://pair?version=1&challenge=challenge-1&code=ABCD2345&relay=${encodeURIComponent(
          relayEndpoint,
        )}&relayId=${relayId}`,
      ),
    ).toThrow('must include a Tailscale Direct Host address');
  });

  it('rejects an invalid Direct Host address', () => {
    expect(() =>
      parsePairingUriV1(
        `mira://pair?version=1&challenge=challenge-1&code=ABCD2345&host=${encodeURIComponent(
          'not-a-host',
        )}`,
      ),
    ).toThrow('Mira Host address is not a valid URL');
  });

  it('rejects ordinary HTTP(S) URLs as pairing input', () => {
    expect(() =>
      parsePairingUriV1('https://desktop.example.ts.net/remote/pairing'),
    ).toThrow('Pairing link must start with mira://pair');
  });

  it('rejects Mira pairing links missing required request fields', () => {
    expect(() =>
      parsePairingUriV1(
        'mira://pair?version=1&host=https%3A%2F%2Fdesktop.example.ts.net',
      ),
    ).toThrow('Pairing link is missing challenge or code');
  });
});
