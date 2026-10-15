import { describe, expect, it, vi } from "vitest";

import { OFFICE_FEATURE_DISABLED, officeContextPhase, stopOfficeFrameMedia } from "./context-status";

describe("office frame context disposition", () => {
  it("distinguishes explicit rollback from revoked membership", () => {
    expect(officeContextPhase(503, { code: OFFICE_FEATURE_DISABLED })).toBe("unavailable");
    expect(officeContextPhase(401, null)).toBe("expired");
    expect(officeContextPhase(403, { code: OFFICE_FEATURE_DISABLED })).toBe("expired");
  });

  it.each([
    [200, { code: OFFICE_FEATURE_DISABLED }], [503, null], [503, {}],
    [503, { code: "OFFICE_UNAVAILABLE" }], [503, "OFFICE_FEATURE_DISABLED"],
    [500, { code: OFFICE_FEATURE_DISABLED }], [429, null],
  ])("does not treat a temporary or unrelated response as revocation (%s %o)", (status, body) => {
    expect(officeContextPhase(status, body)).toBeNull();
  });
});

describe("office iframe media teardown", () => {
  it("calls all capture hooks, stops available tracks and disconnects peers", () => {
    const audio = { stop: vi.fn() }, camera = { stop: vi.fn() }, screen = { stop: vi.fn() };
    const target = {
      aureonStopMicrophone: vi.fn(), aureonStopCamera: vi.fn(), aureonStopScreen: vi.fn(),
      aureonAudioStream: () => ({ getTracks: () => [audio] }),
      aureonCameraStream: () => ({ getTracks: () => [camera] }),
      aureonScreenStream: () => ({ getTracks: () => [screen] }),
      aureonReplicaCalls: { disconnectSession: vi.fn() },
    };
    stopOfficeFrameMedia(target);
    for (const hook of [target.aureonStopMicrophone, target.aureonStopCamera, target.aureonStopScreen]) expect(hook).toHaveBeenCalledOnce();
    for (const track of [audio, camera, screen]) expect(track.stop).toHaveBeenCalledOnce();
    expect(target.aureonReplicaCalls.disconnectSession).toHaveBeenCalledOnce();
  });

  it("continues teardown if one capture throws or rejects", async () => {
    const stop = vi.fn(), disconnectSession = vi.fn();
    const target = {
      aureonStopMicrophone() { throw new Error("device unavailable"); },
      aureonStopCamera: () => Promise.reject(new Error("camera unavailable")),
      aureonStopScreen: vi.fn(),
      get aureonAudioStream() { throw new Error("stream unavailable"); },
      aureonCameraStream: () => ({ getTracks: () => [{ stop() { throw new Error("closed"); } }, { stop }] }),
      aureonReplicaCalls: { disconnectSession },
    };
    expect(() => stopOfficeFrameMedia(target)).not.toThrow();
    await Promise.resolve();
    expect(target.aureonStopScreen).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(disconnectSession).toHaveBeenCalledOnce();
  });

  it("allows an absent or not-yet-initialized iframe runtime", () => {
    for (const target of [null, undefined, {}, { aureonReplicaCalls: null }]) {
      expect(() => stopOfficeFrameMedia(target)).not.toThrow();
    }
  });
});
