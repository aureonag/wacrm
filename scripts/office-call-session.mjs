// Serialized into the calls closure. This controller owns no device or stream.
export function createOfficeCallSession(env) {
  const win = env.window, doc = env.document;
  let paused = false, disposed = false, resuming = false, notice = null, style = null, resumeButton = null;
  function context() { try { return env.getContext(); } catch { return null; } }
  function admitted(value) {
    return value?.active === true && value.selfId && value.status !== 'offline' && value.meeting?.phase !== 'completed'
      && Array.isArray(value.meeting?.members) && value.meeting.members.includes(value.selfId);
  }
  function capture() {
    const value = context();
    return !disposed && !paused && admitted(value) && value.roomId === value.meeting.id && value.callId
      ? {generation:value.generation, roomId:value.roomId, callId:value.callId} : null;
  }
  function isCurrent(token) {
    const value = capture();
    return !!token && !!value && token.generation === value.generation && token.roomId === value.roomId && token.callId === value.callId;
  }
  function render() {
    if (disposed || !paused) { notice?.remove(); return; }
    if (!notice) {
      style = doc.createElement('style');
      style.textContent = '.aureon-call-paused{position:fixed;top:16px;right:16px;z-index:95;width:min(420px,calc(100% - 32px));box-sizing:border-box;padding:16px;border:1px solid var(--crm-border,#454545);border-radius:12px;background:var(--crm-card,#292a2c);color:var(--crm-text,#e0e0e0);font:inherit;box-shadow:0 4px 18px #0003}.aureon-call-paused strong{display:block;font-size:14px}.aureon-call-paused p{font-size:12px;line-height:1.5;margin:8px 0 12px;color:var(--crm-muted,#b9bcc4)}.aureon-call-paused button{font:inherit;font-size:12px;padding:8px 12px;border:1px solid #75608f;border-radius:8px;background:#47316d;color:#f0f1f6}.aureon-call-paused button:focus-visible{outline:2px solid #bfa5ff;outline-offset:3px}.aureon-call-paused button:disabled{opacity:.6;cursor:default}';
      (doc.head || doc.body).append(style);
      notice = doc.createElement('aside'); notice.className = 'aureon-call-paused'; notice.id = 'aureonCallPaused';
      notice.setAttribute('role', 'status');
      const title = doc.createElement('strong'); title.textContent = 'Chamada pausada nesta guia';
      const help = doc.createElement('p'); help.textContent = 'A sessão desta chamada foi substituída. Retome aqui se quiser continuar nesta guia. Depois, ligue seus dispositivos quando quiser.';
      resumeButton = doc.createElement('button'); resumeButton.type = 'button'; resumeButton.textContent = 'Retomar chamada aqui';
      resumeButton.addEventListener('click', () => { void resume(); });
      notice.append(title, help, resumeButton);
    }
    resumeButton.disabled = resuming || !admitted(context());
    if (!notice.isConnected) doc.body.append(notice);
  }
  function handle(error, token) {
    if (error?.status !== 409 || error.code !== 'OFFICE_CALL_SESSION_REPLACED') return false;
    // Even an obsolete replacement error is consumed; it must not reset the new call.
    if (!isCurrent(token)) return true;
    paused = true;
    env.disconnect();
    render();
    return true;
  }
  async function resume() {
    if (disposed || !paused || resuming || !admitted(context())) return false;
    resuming = true; paused = false; render();
    try { await env.reconnect(); return !disposed && !paused; }
    catch { return false; }
    finally { resuming = false; render(); }
  }
  function blockCapture(event) {
    if (disposed || !paused || !event.target?.closest?.('#mic,#camera,#screen,#micSettings,#cameraSettings,#devicePopover')) return;
    event.preventDefault(); event.stopImmediatePropagation(); render(); resumeButton?.focus();
  }
  win.addEventListener('click', blockCapture, true);
  win.addEventListener('change', blockCapture, true);
  function dispose() {
    if (disposed) return;
    disposed = true;
    win.removeEventListener?.('click', blockCapture, true); win.removeEventListener?.('change', blockCapture, true);
    notice?.remove(); style?.remove();
  }
  return {capture, isCurrent, handle, render, resume, dispose, isPaused:()=>paused, canRun:()=>!disposed && !paused};
}
