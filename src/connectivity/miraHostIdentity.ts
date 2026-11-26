export interface MiraHostIdentity {
  name: string;
  displayName: string;
  version: string;
}

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const unwrapData = (value: unknown): unknown => {
  const record = asRecord(value);
  return record && 'data' in record ? record.data : value;
};

export const parseTailscaleMiraHostIdentity = (value: unknown): MiraHostIdentity | null => {
  const record = asRecord(unwrapData(value));
  if (!record) return null;

  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const displayName =
    typeof record.displayName === 'string' ? record.displayName.trim() : '';
  const version =
    typeof record.version === 'string' ? record.version.trim() : '';

  if (!name || !displayName || !version) return null;

  const marker = `${name} ${displayName}`.toLowerCase();
  if (!marker.includes('mira') && !marker.includes('uichat')) return null;

  return { name, displayName, version };
};
