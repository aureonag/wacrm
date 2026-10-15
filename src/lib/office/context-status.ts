export const OFFICE_FEATURE_DISABLED = "OFFICE_FEATURE_DISABLED";

/** Only an explicit feature rollback turns a 503 into a terminal frame state. */
export function officeContextPhase(status: number, body: unknown): "expired" | "unavailable" | null {
  if (status === 401 || status === 403) return "expired";
  if (status === 503 && body !== null && typeof body === "object" &&
    "code" in body && body.code === OFFICE_FEATURE_DISABLED) return "unavailable";
  return null;
}

function attempt(action: () => unknown) {
  try { void Promise.resolve(action()).catch(() => {}); } catch { /* Continue stopping other media. */ }
}

/** Best-effort synchronous teardown before React removes the same-origin iframe. */
export function stopOfficeFrameMedia(target: object | null | undefined): void {
  if (!target) return;
  for (const name of ["aureonStopMicrophone", "aureonStopCamera", "aureonStopScreen"]) {
    attempt(() => {
      const action: unknown = Reflect.get(target, name);
      if (typeof action === "function") return Reflect.apply(action, target, []);
    });
  }
  for (const name of ["aureonAudioStream", "aureonCameraStream", "aureonScreenStream"]) {
    attempt(() => {
      const current: unknown = Reflect.get(target, name);
      const stream: unknown = typeof current === "function" ? Reflect.apply(current, target, []) : null;
      if (!stream || typeof stream !== "object" || !("getTracks" in stream) || typeof stream.getTracks !== "function") return;
      const tracks: unknown = stream.getTracks();
      if (!Array.isArray(tracks)) return;
      for (const track of tracks) attempt(() => {
        if (track && typeof track === "object" && "stop" in track && typeof track.stop === "function") track.stop();
      });
    });
  }
  attempt(() => {
    const calls: unknown = Reflect.get(target, "aureonReplicaCalls");
    if (calls && typeof calls === "object" && "disconnectSession" in calls && typeof calls.disconnectSession === "function") {
      return calls.disconnectSession();
    }
  });
}
