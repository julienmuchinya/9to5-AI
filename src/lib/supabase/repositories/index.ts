import { getStorageAdapter } from "@/lib/storage/storageAdapter";
import type { AppStore } from "@/lib/storage/storageAdapter";

export async function loadAppStore(): Promise<AppStore> {
  return getStorageAdapter().load();
}

export async function saveAppStore(store: AppStore): Promise<void> {
  return getStorageAdapter().save(store);
}

export { getStorageAdapter };
