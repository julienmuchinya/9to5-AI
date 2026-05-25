import { validateSetupForStore } from "@/lib/setup/setupValidator";
import { loadAppStore } from "./index";

export async function getSetupStatus() {
  const store = await loadAppStore();
  return validateSetupForStore(store);
}
