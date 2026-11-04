import type { LocalStore } from "@/lib/store/default-store";

export type AppStore = LocalStore;

export interface StorageAdapter {
  readonly mode: "mock" | "supabase";
  isAvailable(): boolean;
  load(): Promise<AppStore>;
  save(store: AppStore): Promise<void>;
}

export interface MockDataExport {
  version: 1;
  exportedAt: string;
  store: AppStore;
}

import { isMockModeEnv } from "@/lib/config/env";
import { MockStorageAdapter } from "./mockStorageAdapter";
import { SupabaseStorageAdapter } from "./supabaseStorageAdapter";

export function getStorageAdapter(): StorageAdapter {
  if (isMockModeEnv()) return new MockStorageAdapter();
  const supabase = new SupabaseStorageAdapter();
  if (supabase.isAvailable()) return supabase;
  return new MockStorageAdapter();
}
