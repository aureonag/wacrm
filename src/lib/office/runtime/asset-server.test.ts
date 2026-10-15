import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createLoader: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("./assets", () => ({ createOfficeAssetLoader: (...args: unknown[]) => mocks.createLoader(...args) }));

let OfficeConfigurationError: typeof import("@/lib/office/access").OfficeConfigurationError;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("AUREON_OFFICE_ENABLED", "true");
  vi.stubEnv("AUREON_OFFICE_TRANSPORT", "local");
  OfficeConfigurationError = (await import("@/lib/office/access")).OfficeConfigurationError;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("explicit private office runtime configuration", () => {
  it.each([undefined, "", "   ", ".office-runtime", "./.office-runtime-optimized", "../runtime", "~/runtime", "C:runtime"])(
    "fails closed without an absolute configured release (%s)",
    async (configured) => {
      vi.stubEnv("AUREON_OFFICE_RUNTIME_DIR", configured);
      const { getOfficeAssets } = await import("./asset-server");
      expect(() => getOfficeAssets()).toThrowError(OfficeConfigurationError);
      try { getOfficeAssets(); } catch (error) {
        expect(error).toMatchObject({ status: 503 });
      }
      expect(mocks.createLoader).not.toHaveBeenCalled();
    },
  );

  it("requires the feature flag before constructing or inspecting a configured release", async () => {
    vi.stubEnv("AUREON_OFFICE_RUNTIME_DIR", path.resolve(os.tmpdir(), "office-explicit-release"));
    vi.stubEnv("AUREON_OFFICE_ENABLED", "false");
    const { getOfficeAssets } = await import("./asset-server");
    expect(() => getOfficeAssets()).toThrowError(OfficeConfigurationError);
    expect(mocks.createLoader).not.toHaveBeenCalled();
  });

  it("uses only the configured absolute release and reuses its CRM-validated loader", async () => {
    const directory = path.resolve(os.tmpdir(), "office-explicit-release");
    const loader = { load: vi.fn() };
    mocks.createLoader.mockReturnValue(loader);
    vi.stubEnv("AUREON_OFFICE_RUNTIME_DIR", "  " + directory + "  ");
    const { getOfficeAssets } = await import("./asset-server");
    expect(getOfficeAssets()).toBe(loader);
    expect(getOfficeAssets()).toBe(loader);
    expect(mocks.createLoader).toHaveBeenCalledExactlyOnceWith({ directory, requireCrmBootstrap: true });
  });

  it("does not cache or infer a directory after missing configuration", async () => {
    vi.stubEnv("AUREON_OFFICE_RUNTIME_DIR", undefined);
    const { getOfficeAssets } = await import("./asset-server");
    expect(() => getOfficeAssets()).toThrowError(OfficeConfigurationError);
    const directory = path.resolve(os.tmpdir(), "office-explicit-release");
    const loader = { load: vi.fn() };
    mocks.createLoader.mockReturnValue(loader);
    vi.stubEnv("AUREON_OFFICE_RUNTIME_DIR", directory);
    expect(getOfficeAssets()).toBe(loader);
    expect(mocks.createLoader).toHaveBeenCalledExactlyOnceWith({ directory, requireCrmBootstrap: true });
  });
});
