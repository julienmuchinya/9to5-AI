import { getDefaultStore } from "@/lib/store/default-store";
import { loadStore, saveStore } from "@/lib/store/local-store";
import type { AppStore, StorageAdapter } from "./storageAdapter";

export class MockStorageAdapter implements StorageAdapter {
  readonly mode = "mock" as const;

  isAvailable(): boolean {
    return true;
  }

  async load(): Promise<AppStore> {
    if (typeof window !== "undefined") {
      return loadStore();
    }
    return getDefaultStore();
  }

  async save(store: AppStore): Promise<void> {
    if (typeof window !== "undefined") {
      saveStore(store);
    }
  }
}

export function exportMockData(store: AppStore): string {
  const payload = {
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    store,
  };
  return JSON.stringify(payload, null, 2);
}

export function importMockData(json: string): AppStore {
  const parsed = JSON.parse(json) as { version?: number; store?: AppStore };
  if (!parsed.store) {
    throw new Error("Invalid export: missing store");
  }
  return parsed.store;
}
