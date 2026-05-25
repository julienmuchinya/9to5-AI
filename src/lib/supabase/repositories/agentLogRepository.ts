import { loadAppStore } from "./index";

export async function listAgentLogs(limit = 100) {
  const store = await loadAppStore();
  return store.agent_logs.slice(0, limit);
}
