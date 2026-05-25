import { loadAppStore } from "./index";

export async function listBlockedActions() {
  const store = await loadAppStore();
  return store.blocked_actions;
}
