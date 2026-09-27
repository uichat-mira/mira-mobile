import { Platform } from 'react-native';

export const REPORT_FEEDBACK_EMAIL = 'hello@mira.io';

export type ReportConnectionMode = 'remote' | 'local-provider' | 'none';

export interface ReportDiagnosticsInput {
  appVersion: string;
  remotePaired: boolean;
  localProviderCount: number;
  now?: Date;
}

export interface ReportDiagnostics {
  appVersion: string;
  platform: string;
  osVersion: string;
  locale: string;
  connectionMode: ReportConnectionMode;
  reportedAt: string;
}

const CONNECTION_MODE_LABELS: Record<ReportConnectionMode, string> = {
  remote: '远程 Host',
  'local-provider': '本地 Provider',
  none: '未连接',
};

export function resolveReportConnectionMode(
  remotePaired: boolean,
  localProviderCount: number,
): ReportConnectionMode {
  if (remotePaired) return 'remote';
  if (localProviderCount > 0) return 'local-provider';
  return 'none';
}

const resolveLocale = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'unknown';
  } catch {
    return 'unknown';
  }
};

export function buildReportDiagnostics(input: ReportDiagnosticsInput): ReportDiagnostics {
  return {
    appVersion: input.appVersion,
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    locale: resolveLocale(),
    connectionMode: resolveReportConnectionMode(input.remotePaired, input.localProviderCount),
    reportedAt: (input.now ?? new Date()).toISOString(),
  };
}

export function formatReportDiagnostics(diagnostics: ReportDiagnostics): string {
  return [
    `App 版本：${diagnostics.appVersion}`,
    `平台：${diagnostics.platform}（系统版本 ${diagnostics.osVersion}）`,
    `语言：${diagnostics.locale}`,
    `连接模式：${CONNECTION_MODE_LABELS[diagnostics.connectionMode]}`,
    `报告时间：${diagnostics.reportedAt}`,
  ].join('\n');
}

export function buildReportMailtoUrl(description: string, diagnostics: ReportDiagnostics): string {
  const subject = `Mira Mobile 报告错误 v${diagnostics.appVersion}`;
  const body = `${description.trim()}\n\n———\n${formatReportDiagnostics(diagnostics)}`;
  const query = [
    `subject=${encodeURIComponent(subject)}`,
    `body=${encodeURIComponent(body)}`,
  ].join('&');
  return `mailto:${REPORT_FEEDBACK_EMAIL}?${query}`;
}
