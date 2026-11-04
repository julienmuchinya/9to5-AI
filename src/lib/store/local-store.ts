"use client";

import { getDefaultStore, type LocalStore } from "./default-store";

export type { LocalStore } from "./default-store";
export { getDefaultStore } from "./default-store";

const KEY = "9to5-ai-store";

export function loadStore(): LocalStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const def = getDefaultStore();
      localStorage.setItem(KEY, JSON.stringify(def));
      return def;
    }
    return JSON.parse(raw) as LocalStore;
  } catch {
    return getDefaultStore();
  }
}

export function saveStore(store: LocalStore) {
  localStorage.setItem(KEY, JSON.stringify(store));
}

export function resetStore() {
  localStorage.setItem(KEY, JSON.stringify(getDefaultStore()));
}
