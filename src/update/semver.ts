export interface SemverVersion {
  major: number;
  minor: number;
  patch: number;
}

export type SemverDiff = 'major' | 'minor' | 'patch' | 'equal';

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export const parseSemver = (value: string): SemverVersion | null => {
  const match = SEMVER_PATTERN.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

export const compareSemver = (
  left: SemverVersion,
  right: SemverVersion,
): number => {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
};

export const formatSemver = (version: SemverVersion): string =>
  `${version.major}.${version.minor}.${version.patch}`;

/**
 * The highest component that changed between two versions. Callers must only
 * use it for a strictly newer version; equal or older input is reported as
 * `equal` and carries no update meaning.
 */
export const diffSemver = (
  newer: SemverVersion,
  older: SemverVersion,
): SemverDiff => {
  if (compareSemver(newer, older) <= 0) return 'equal';
  if (newer.major !== older.major) return 'major';
  if (newer.minor !== older.minor) return 'minor';
  return 'patch';
};
