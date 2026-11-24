import {
  checkPublicWebUrl,
  isPublicAddressLiteral,
  isPublicIPv4,
  isPublicIPv6,
} from './urlPolicy';

const accepted = [
  'https://example.com/article',
  'http://example.com:8080/path?q=1#section',
  'https://1.1.1.1/',
  'https://[2606:4700:4700::1111]/',
  'https://news.example.co.uk/',
];

const rejected: Array<[string, string]> = [
  ['ftp://example.com/', 'unsupported-scheme'],
  ['file:///etc/passwd', 'unsupported-scheme'],
  ['java' + 'script:alert(1)', 'unsupported-scheme'],  ['data:text/html,hello', 'unsupported-scheme'],
  ['https://user:pass@example.com/', 'credentials'],
  ['http://127.0.0.1/', 'non-public-address'],
  ['http://127.1/', 'non-public-address'],
  ['http://2130706433/', 'non-public-address'],
  ['http://0x7f000001/', 'non-public-address'],
  ['http://10.0.0.1/', 'non-public-address'],
  ['http://172.16.0.1/', 'non-public-address'],
  ['http://192.168.1.1/', 'non-public-address'],
  ['http://169.254.169.254/latest/meta-data', 'non-public-address'],
  ['http://100.64.0.1/', 'non-public-address'],
  ['http://224.0.0.1/', 'non-public-address'],
  ['http://[::1]/', 'non-public-address'],
  ['http://[::]/', 'non-public-address'],
  ['http://[fc00::1]/', 'non-public-address'],
  ['http://[fd12:3456::1]/', 'non-public-address'],
  ['http://[fe80::1]/', 'non-public-address'],
  ['http://[::ffff:127.0.0.1]/', 'non-public-address'],
  ['http://[2002:7f00:1::]/', 'non-public-address'],
  ['http://[2001:db8::1]/', 'non-public-address'],
  ['http://localhost/', 'local-hostname'],
  ['http://foo.localhost/', 'local-hostname'],
  ['http://router.local/', 'local-hostname'],
  ['http://intranet/', 'unqualified-hostname'],
  ['', 'missing-host'],
];

describe('public web URL policy', () => {
  it.each(accepted)('accepts %s', value => {
    const result = checkPublicWebUrl(value);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.href.startsWith('http')).toBe(true);
      expect(result.href).not.toContain('#');
    }
  });

  it.each(rejected)('rejects %s as %s', (value, reason) => {
    expect(checkPublicWebUrl(value)).toMatchObject({ ok: false, reason });
  });

  it('rejects URLs beyond the hard length bound', () => {
    expect(checkPublicWebUrl(`https://example.com/${'a'.repeat(5000)}`)).toMatchObject({
      ok: false,
      reason: 'too-long',
    });
  });

  it('classifies IPv4 special-purpose ranges', () => {
    expect(isPublicIPv4([8, 8, 8, 8])).toBe(true);
    expect(isPublicIPv4([1, 1, 1, 1])).toBe(true);
    expect(isPublicIPv4([192, 168, 0, 1])).toBe(false);
    expect(isPublicIPv4([198, 18, 0, 1])).toBe(false);
    expect(isPublicIPv4([203, 0, 113, 9])).toBe(false);
    expect(isPublicIPv4([255, 255, 255, 255])).toBe(false);
  });

  it('classifies IPv6 global unicast and special ranges', () => {
    expect(isPublicIPv6([0x2606, 0x4700, 0x4700, 0, 0, 0, 0, 0x1111])).toBe(true);
    expect(isPublicIPv6([0x2001, 0x4860, 0x4860, 0, 0, 0, 0, 0x8888])).toBe(true);
    expect(isPublicIPv6([0, 0, 0, 0, 0, 0, 0, 1])).toBe(false);
    expect(isPublicIPv6([0xfc00, 0, 0, 0, 0, 0, 0, 1])).toBe(false);
    expect(isPublicIPv6([0xfe80, 0, 0, 0, 0, 0, 0, 1])).toBe(false);
    expect(isPublicIPv6([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1])).toBe(false);
    expect(isPublicIPv6([0x2001, 0, 0, 0, 0, 0, 0, 1])).toBe(false);
    expect(isPublicIPv6([0x3fff, 0, 0, 0, 0, 0, 0, 1])).toBe(false);
  });

  it('distinguishes hostnames from address literals', () => {
    expect(isPublicAddressLiteral('example.com')).toBeNull();
    expect(isPublicAddressLiteral('[2606:4700:4700::1111]')).toBe(true);
    expect(isPublicAddressLiteral('127.0.0.1')).toBe(false);
    expect(isPublicAddressLiteral('not-an-address')).toBeNull();
  });
});
