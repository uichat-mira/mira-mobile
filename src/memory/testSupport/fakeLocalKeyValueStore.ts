import type { LocalKeyValueStore } from '../../storage/localKeyValueStore';

// Test double for the Mobile key-value storage primitive. It tracks the raw
// string values so tests can inspect persisted documents and inject corrupt
// data without touching platform storage.
export class FakeLocalKeyValueStore implements LocalKeyValueStore {
  private readonly values = new Map<string, string>();
  private failNextSet = false;

  isAvailable() {
    return true;
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    if (this.failNextSet) {
      this.failNextSet = false;
      throw new Error('simulated storage write failure');
    }
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }

  seed(key: string, value: string): void {
    this.values.set(key, value);
  }

  failNextWrite(): void {
    this.failNextSet = true;
  }

  raw(key: string): string | null {
    return this.values.get(key) ?? null;
  }
}
