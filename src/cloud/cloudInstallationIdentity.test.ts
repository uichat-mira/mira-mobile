import {
  CloudInstallationStoreError,
  MiraCloudInstallationIdentity,
  MemoryCloudInstallationStore,
  parseStoredCloudInstallation,
} from './cloudInstallationIdentity';
import { bytesToBase64Url, isValidUuidV4 } from './pkce';
import type { SecureRandomModule } from './secureStorage';

const makeRandom = (): SecureRandomModule => {
  let counter = 0;
  return {
    get: async () => null,
    set: async () => undefined,
    remove: async () => undefined,
    randomBytes: async length => {
      const bytes = Uint8Array.from(
        { length },
        (_, index) => (counter + index + 1) & 0xff,
      );
      counter += length;
      return bytesToBase64Url(bytes);
    },
  };
};

describe('Mira Cloud installation identity', () => {
  it('persists one random UUIDv4 and reuses it on later starts', async () => {
    const store = new MemoryCloudInstallationStore();
    const identity = new MiraCloudInstallationIdentity(
      store,
      makeRandom(),
      () => new Date('2026-10-25T11:00:00.000Z'),
    );

    const first = await identity.getOrCreate();
    const second = await new MiraCloudInstallationIdentity(
      store,
      makeRandom(),
    ).getOrCreate();

    expect(isValidUuidV4(first)).toBe(true);
    expect(second).toBe(first);
    expect(store.peek()).toMatchObject({
      schemaVersion: 1,
      installationId: first,
      createdAt: '2026-10-25T11:00:00.000Z',
    });
  });

  it('rejects a corrupted identity instead of silently creating a duplicate device', async () => {
    const random = makeRandom();
    const randomBytes = jest.spyOn(random, 'randomBytes');
    const identity = new MiraCloudInstallationIdentity(
      {
        load: async () => {
          throw new CloudInstallationStoreError('corrupt');
        },
        save: async () => undefined,
      },
      random,
    );

    await expect(identity.getOrCreate()).rejects.toBeInstanceOf(
      CloudInstallationStoreError,
    );
    expect(randomBytes).not.toHaveBeenCalled();
  });

  it('validates stored installation records', () => {
    expect(
      parseStoredCloudInstallation(
        JSON.stringify({
          schemaVersion: 1,
          installationId: '6f9619ff-8b86-4d01-b42d-00c04fc964ff',
          createdAt: '2026-10-25T11:00:00.000Z',
        }),
      ),
    ).toMatchObject({
      installationId: '6f9619ff-8b86-4d01-b42d-00c04fc964ff',
    });
    expect(() =>
      parseStoredCloudInstallation(
        JSON.stringify({
          schemaVersion: 1,
          installationId: 'not-a-uuid',
          createdAt: '2026-10-25T11:00:00.000Z',
        }),
      ),
    ).toThrow(CloudInstallationStoreError);
  });
});
