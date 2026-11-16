const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');

const readSource = path => readFileSync(resolve(process.cwd(), path), 'utf8');

const cloudSources = () =>
  readdirSync(resolve(process.cwd(), 'src/cloud'))
    .filter(name => name.endsWith('.ts') && !name.includes('.test.'))
    .map(name => ({ name, source: readSource(`src/cloud/${name}`) }));

describe('MOB-078 Mira Cloud credential isolation', () => {
  it('keeps all Cloud material behind the platform secure credential bridge', () => {
    for (const { name, source } of cloudSources()) {
      expect({
        name,
        generalKv: source.includes('localKeyValueStore'),
      }).toEqual({
        name,
        generalKv: false,
      });
      expect({ name, asyncStorage: source.includes('AsyncStorage') }).toEqual({
        name,
        asyncStorage: false,
      });
      expect({
        name,
        remoteCredential:
          /deviceCredentialStore|providerCredentialStore|pushBindingState/.test(
            source,
          ),
      }).toEqual({ name, remoteCredential: false });
    }
  });

  it('never logs raw Cloud codes, verifiers, tokens or account material', () => {
    for (const { name, source } of cloudSources()) {
      expect({
        name,
        logs: /console\.(log|info|warn|error|debug)/u.test(source),
      }).toEqual({
        name,
        logs: false,
      });
    }
  });

  it('uses separate secure-storage namespaces for session, installation and pending PKCE', () => {
    const combined = cloudSources()
      .map(({ source }) => source)
      .join('\n');
    expect(combined).toContain('io.tomz.mira.mobile.cloud-account.v1');
    expect(combined).toContain('io.tomz.mira.mobile.cloud-installation.v1');
    expect(combined).toContain('io.tomz.mira.mobile.cloud-oauth-pending.v1');
    expect(combined).not.toContain('io.tomz.mira.mobile.push-installation');
    expect(combined).not.toContain('io.tomz.mira.mobile.remote-device');
    expect(combined).not.toContain('io.tomz.mira.mobile.local-provider');
  });

  it('registers only the reviewed Mobile OAuth client and callback', () => {
    const config = readSource('src/cloud/cloudAuthConfig.ts');
    expect(config).toContain("CLOUD_AUTH_CLIENT_ID = 'mira-mobile'");
    expect(config).toContain(
      "CLOUD_AUTH_REDIRECT_URI = 'mira-mobile://oauth/callback'",
    );
    expect(readSource('App.tsx')).toContain('mira-mobile://');
    expect(readSource('App.tsx')).toContain(
      "CloudAuthCallback: 'oauth/callback'",
    );
    expect(readSource('android/app/src/main/AndroidManifest.xml')).toContain(
      'android:scheme="mira-mobile" android:host="oauth" android:path="/callback"',
    );
    expect(readSource('ios/UIChatMira/Info.plist')).toContain(
      '<string>mira-mobile</string>',
    );
  });
});
