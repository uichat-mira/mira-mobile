import type { Session } from '../types';
import {
  deviceCredentialStore,
  type DeviceCredentialStore,
} from '../security/deviceCredentialStore';
import {
  RemoteHostError,
  requestRemoteJson,
  type RemoteJsonRequest,
} from './remoteHttp';

export interface MobileRoleSummary {
  id: string;
  name: string;
}

export type RoleNameMap = Readonly<Record<string, string>>;

type JsonTransport = <T>(request: RemoteJsonRequest<T>) => Promise<T>;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requiredString = (
  record: Record<string, unknown>,
  key: string,
  context: string,
): string => {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${context}.${key} must be a non-empty string`);
  }
  return value;
};

export const parseMobileRoleSummary = (value: unknown): MobileRoleSummary => {
  if (!isRecord(value)) {
    throw new Error('roleSummary must be an object');
  }

  const unexpectedKeys = Object.keys(value).filter(
    key => key !== 'id' && key !== 'name',
  );
  if (unexpectedKeys.length > 0) {
    throw new Error(
      `roleSummary contains unsupported fields: ${unexpectedKeys.join(', ')}`,
    );
  }

  return {
    id: requiredString(value, 'id', 'roleSummary'),
    name: requiredString(value, 'name', 'roleSummary'),
  };
};

const parseRoleSummaryList = (value: unknown): MobileRoleSummary[] => {
  if (!Array.isArray(value)) {
    throw new Error('roleSummaries must be an array');
  }
  return value.map(parseMobileRoleSummary);
};

export const buildRoleNameMap = (
  roles: readonly MobileRoleSummary[],
): RoleNameMap => {
  const names: Record<string, string> = {};
  for (const role of roles) {
    names[role.id] = role.name;
  }
  return names;
};

export const getSessionRoleName = (
  session: Pick<Session, 'agentEnabled' | 'roleId'>,
  roleNames: RoleNameMap,
): string | null => {
  if (session.agentEnabled === true) return null;
  const roleId = session.roleId?.trim();
  if (!roleId) return null;
  return roleNames[roleId] ?? null;
};

/** Read-only client for the Desktop-provided Mobile-safe Role projection. */
export class RoleApiClient {
  constructor(
    private readonly credentialStore: DeviceCredentialStore = deviceCredentialStore,
    private readonly directTransport: JsonTransport = requestRemoteJson,
  ) {}

  async listRoleSummaries(): Promise<MobileRoleSummary[]> {
    const credential = await this.credentialStore.load();
    if (!credential) {
      throw new RemoteHostError(
        'PAIRING_REQUIRED',
        'This mobile device is not paired with Mira Desktop',
      );
    }

    const makeRequest = (hostUrl: string, allowInsecureDevelopment: boolean) => ({
      hostUrl,
      path: '/remote/v1/roles',
      credential: credential.credential,
      allowInsecureDevelopment,
      parse: parseRoleSummaryList,
    });

    if (credential.hostUrl) {
      return this.directTransport(makeRequest(credential.hostUrl, __DEV__));
    }

    throw new RemoteHostError(
      'REMOTE_ENDPOINT_UNAVAILABLE',
      'No Mira Desktop endpoint is available for reading role summaries',
    );
  }
}

export const roleApi = new RoleApiClient();
