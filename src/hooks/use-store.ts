"use client";

import { useCallback, useEffect, useState } from "react";
import { loadStore, saveStore, type LocalStore } from "@/lib/store/local-store";

export function useLocalStore() {
  const [store, setStore] = useState<LocalStore | null>(null);

  useEffect(() => {
    setStore(loadStore());
  }, []);

  const update = useCallback((updater: (s: LocalStore) => LocalStore) => {
    setStore((prev) => {
      const base = prev ?? loadStore();
      const next = updater(base);
      saveStore(next);
      return next;
    });
  }, []);

  return { store, update, ready: store !== null };
}
