import { detectRuntimeMode } from "@/lib/config/runtimeMode";
import { PASSWORD_STORAGE_ENABLED } from "@/lib/constants";

export interface ProductionSafetyState {
  autopilotDefaultOff: boolean;
  emergencyStopDefaultOn: boolean;
  passwordStorageDisabled: boolean;
  outreachBlocked: boolean;
  realApplyBlocked: boolean;
  captchaBypassBlocked: boolean;
  linkedInAutomationBlocked: boolean;
}

export function getProductionSafetyDefaults(): ProductionSafetyState {
  const mode = detectRuntimeMode();
  const isLive = mode !== "MOCK_LOCAL";

  return {
    autopilotDefaultOff: true,
    emergencyStopDefaultOn: isLive,
    passwordStorageDisabled: !PASSWORD_STORAGE_ENABLED,
    outreachBlocked: true,
    realApplyBlocked: true,
    captchaBypassBlocked: true,
    linkedInAutomationBlocked: true,
  };
}

export function enforceLiveAutopilotDefaults(settings: {
  auto_apply_enabled: boolean;
  emergency_stop: boolean;
  mock_mode: boolean;
}): { auto_apply_enabled: boolean; emergency_stop: boolean } {
  const mode = detectRuntimeMode();
  if (mode === "MOCK_LOCAL") return settings;

  return {
    auto_apply_enabled: settings.auto_apply_enabled,
    emergency_stop: settings.emergency_stop,
  };
}
