import { describe, it, expect, afterEach } from "vitest";
import { getStorageAdapter } from "./storageAdapter";
import { MockStorageAdapter } from "./mockStorageAdapter";

describe("storage adapter", () => {
  const orig = { ...process.env };

  afterEach(() => {
    process.env = { ...orig };
  });

  it("uses mock adapter when mock mode", () => {
    process.env.NEXT_PUBLIC_MOCK_MODE = "true";
    const adapter = getStorageAdapter();
    expect(adapter.mode).toBe("mock");
    expect(adapter).toBeInstanceOf(MockStorageAdapter);
  });
});
