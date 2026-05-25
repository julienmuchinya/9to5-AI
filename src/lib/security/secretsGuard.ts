import { SERVER_ONLY_KEYS, stripServerSecrets } from "@/lib/config/env";

export function assertNoServerSecretsInPayload(
  payload: Record<string, unknown>
): void {
  for (const key of SERVER_ONLY_KEYS) {
    if (key in payload && payload[key] != null && payload[key] !== "") {
      throw new Error(`Server secret "${key}" must not be exposed to the client`);
    }
  }
}

export function safeClientPayload<T extends Record<string, unknown>>(
  payload: T
): Partial<T> {
  return stripServerSecrets(payload) as Partial<T>;
}

export function isPasswordStorageAllowed(
  settingEnabled: boolean,
  envEncryptionReady: boolean
): boolean {
  if (!settingEnabled) return false;
  return envEncryptionReady;
}
