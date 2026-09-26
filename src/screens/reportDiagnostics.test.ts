import {
  buildReportDiagnostics,
  buildReportMailtoUrl,
  formatReportDiagnostics,
  REPORT_FEEDBACK_EMAIL,
  resolveReportConnectionMode,
} from './reportDiagnostics';

describe('resolveReportConnectionMode', () => {
  it('prefers remote host when paired', () => {
    expect(resolveReportConnectionMode(true, 2)).toBe('remote');
  });

  it('falls back to local provider when configured', () => {
    expect(resolveReportConnectionMode(false, 1)).toBe('local-provider');
  });

  it('reports none when neither is available', () => {
    expect(resolveReportConnectionMode(false, 0)).toBe('none');
  });
});

describe('buildReportDiagnostics', () => {
  const fixedNow = new Date('2026-09-17T08:30:00.000Z');

  it('collects only the whitelisted safe fields', () => {
    const diagnostics = buildReportDiagnostics({
      appVersion: '0.3.5',
      remotePaired: true,
      localProviderCount: 2,
      now: fixedNow,
    });
    expect(Object.keys(diagnostics).sort()).toEqual(
      ['appVersion', 'connectionMode', 'locale', 'osVersion', 'platform', 'reportedAt'].sort(),
    );
  });

  it('never includes credential or session-sensitive fields', () => {
    const diagnostics = buildReportDiagnostics({
      appVersion: '0.3.5',
      remotePaired: false,
      localProviderCount: 0,
      now: fixedNow,
    });
    const serialized = JSON.stringify(diagnostics).toLowerCase();
    expect(serialized).not.toMatch(
      /token|apikey|api_key|secret|authorization|credential|hosturl|baseurl|password|session/,
    );
  });

  it('uses the provided timestamp', () => {
    const diagnostics = buildReportDiagnostics({
      appVersion: '0.3.5',
      remotePaired: false,
      localProviderCount: 0,
      now: fixedNow,
    });
    expect(diagnostics.reportedAt).toBe('2026-09-17T08:30:00.000Z');
  });
});

describe('formatReportDiagnostics', () => {
  it('renders one line per safe field', () => {
    const formatted = formatReportDiagnostics({
      appVersion: '0.3.5',
      platform: 'android',
      osVersion: '34',
      locale: 'zh-CN',
      connectionMode: 'local-provider',
      reportedAt: '2026-09-17T08:30:00.000Z',
    });
    expect(formatted).toContain('App 版本：0.3.5');
    expect(formatted).toContain('平台：android（系统版本 34）');
    expect(formatted).toContain('语言：zh-CN');
    expect(formatted).toContain('连接模式：本地 Provider');
    expect(formatted).toContain('报告时间：2026-09-17T08:30:00.000Z');
  });
});

describe('buildReportMailtoUrl', () => {
  const diagnostics = {
    appVersion: '0.3.5',
    platform: 'android',
    osVersion: '34',
    locale: 'zh-CN',
    connectionMode: 'remote' as const,
    reportedAt: '2026-09-17T08:30:00.000Z',
  };

  const parseQueryParam = (url: string, key: string): string | null => {
    const query = url.split('?')[1] ?? '';
    for (const pair of query.split('&')) {
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      if (pair.slice(0, eq) === key) return decodeURIComponent(pair.slice(eq + 1));
    }
    return null;
  };

  it('targets the report feedback mailbox', () => {
    const url = buildReportMailtoUrl('应用闪退', diagnostics);
    expect(url.startsWith(`mailto:${REPORT_FEEDBACK_EMAIL}?`)).toBe(true);
  });

  it('url-encodes subject and body without raw whitespace', () => {
    const url = buildReportMailtoUrl('  应用闪退\n复现步骤：打开设置  ', diagnostics);
    expect(url).not.toMatch(/\s/);
    expect(parseQueryParam(url, 'subject')).toBe('Mira Mobile 报告错误 v0.3.5');
    expect(parseQueryParam(url, 'body')).toBe(
      '应用闪退\n复现步骤：打开设置\n\n———\n' +
        'App 版本：0.3.5\n' +
        '平台：android（系统版本 34）\n' +
        '语言：zh-CN\n' +
        '连接模式：远程 Host\n' +
        '报告时间：2026-09-17T08:30:00.000Z',
    );
  });
});
