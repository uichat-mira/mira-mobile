import { parseScannedPairingUri } from './parseScannedPairingUri';
import { parsePairingUriV1 } from '../protocol/remotePairingV1';

describe('parseScannedPairingUri', () => {
  it('accepts a Tailscale Direct pairing QR with historical Relay fields', () => {
    const pairingUri =
      'mira://pair?challenge=challenge-1&code=ABCD2345&version=1&host=https%3A%2F%2Fdesktop.example.ts.net&relay=https%3A%2F%2Frelay.tomz.io&relayId=relay_Dqko12345678901&relayToken=ccccccccccccccccccccccccccccccc1X_Msccccccc';

    const scanned = parseScannedPairingUri(`  ${pairingUri}\n`);

    expect(scanned).toBe(pairingUri);
    expect(parsePairingUriV1(scanned)).toEqual({
      version: 1,
      hostUrl: 'https://desktop.example.ts.net',
      challengeId: 'challenge-1',
      code: 'ABCD2345',
    });
  });

  it('keeps Direct-only pairing QR compatibility', () => {
    const pairingUri =
      'mira://pair?host=https%3A%2F%2Fdesktop.example.ts.net&challenge=challenge-1&code=ABCD2345&version=1';

    expect(parseScannedPairingUri(pairingUri)).toBe(pairingUri);
  });

  it('rejects a Relay-only QR because scanning is a Direct-only entry', () => {
    const pairingUri =
      'mira://pair?challenge=challenge-1&code=ABCD2345&version=1&relay=https%3A%2F%2Frelay.tomz.io&relayId=relay_Dqko12345678901&relayToken=ccccccccccccccccccccccccccccccc1X_Msccccccc';

    expect(() => parseScannedPairingUri(pairingUri)).toThrow(
      'must include a Tailscale Direct Host address',
    );
  });
});
