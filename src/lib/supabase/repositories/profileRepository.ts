import { loadAppStore, saveAppStore } from "./index";
import type { AppStore } from "@/lib/storage/storageAdapter";

export async function getProfile() {
  const store = await loadAppStore();
  return store.profile;
}

export async function updateProfile(profile: AppStore["profile"]) {
  const store = await loadAppStore();
  store.profile = profile;
  await saveAppStore(store);
}
