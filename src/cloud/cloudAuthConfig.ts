import { releaseChannel } from 'mira-release-channel';
import { isValidOAuthState, isValidPkceChallenge } from './pkce';

export const CLOUD_AUTH_CLIENT_ID = 'mira-mobile';
export const CLOUD_AUTH_REDIRECT_URI = 'mira-mobile://oauth/callback';
export const CLOUD_AUTH_PLATFORM = 'mobile';

// Origins mirror cloud-auth/deploy/*.caddy; non-production channels use the
// test service so a dev build never signs in against the production account DB.
const CLOUD_AUTH_PROD_BASE_URL = 'https://cloud-auth.tomzlab.cn';
const CLOUD_AUTH_TEST_BASE_URL = 'https://test.cloud-auth.tomzlab.cn';

const AUTHORIZE_PATH = '/v1/oauth/authorize';
const TOKEN_PATH = '/v1/oauth/token';
const SESSION_PATH = '/v1/auth/session';
const SESSION_RENEW_PATH = '/v1/auth/session/renew';
const LOGOUT_PATH = '/v1/auth/logout';
const DEVICES_PATH = '/v1/devices';

export type CloudAuthReleaseChannel = 'predev' | 'dev' | 'test' | 'prod';

export const resolveCloudAuthBaseUrl = (
  channel: CloudAuthReleaseChannel = releaseChannel,
): string =>
  channel === 'prod' ? CLOUD_AUTH_PROD_BASE_URL : CLOUD_AUTH_TEST_BASE_URL;

export const normalizeCloudAuthBaseUrl = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/u, '');
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/u.test(trimmed)) {
    throw new Error('Mira Cloud Auth must use an HTTPS origin');
  }
  return trimmed;
};

export const cloudAuthUrl = (baseUrl: string, path: string): string =>
  `${normalizeCloudAuthBaseUrl(baseUrl)}${path}`;

export const cloudAuthAuthorizeUrl = (baseUrl: string): string =>
  cloudAuthUrl(baseUrl, AUTHORIZE_PATH);

export const cloudAuthTokenUrl = (baseUrl: string): string =>
  cloudAuthUrl(baseUrl, TOKEN_PATH);

export const cloudAuthSessionUrl = (baseUrl: string): string =>
  cloudAuthUrl(baseUrl, SESSION_PATH);

export const cloudAuthSessionRenewUrl = (baseUrl: string): string =>
  cloudAuthUrl(baseUrl, SESSION_RENEW_PATH);

export const cloudAuthLogoutUrl = (baseUrl: string): string =>
  cloudAuthUrl(baseUrl, LOGOUT_PATH);

export const cloudAuthDevicesUrl = (baseUrl: string): string =>
  cloudAuthUrl(baseUrl, DEVICES_PATH);

export const cloudAuthDeviceUrl = (
  baseUrl: string,
  deviceId: string,
): string =>
  cloudAuthUrl(baseUrl, `${DEVICES_PATH}/${encodeURIComponent(deviceId)}`);

export interface AuthorizationUrlInput {
  state: string;
  codeChallenge: string;
}

export const buildCloudAuthorizationUrl = (
  baseUrl: string,
  input: AuthorizationUrlInput,
): string => {
  if (!isValidOAuthState(input.state)) {
    throw new Error('OAuth state is invalid');
  }
  if (!isValidPkceChallenge(input.codeChallenge)) {
    throw new Error('PKCE challenge is invalid');
  }

  const parameters: ReadonlyArray<readonly [string, string]> = [
    ['response_type', 'code'],
    ['client_id', CLOUD_AUTH_CLIENT_ID],
    ['redirect_uri', CLOUD_AUTH_REDIRECT_URI],
    ['state', input.state],
    ['code_challenge', input.codeChallenge],
    ['code_challenge_method', 'S256'],
  ];
  const query = parameters
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `${cloudAuthAuthorizeUrl(baseUrl)}?${query}`;
};
