// This factory is serialized into the calls closure by the runtime packager.
// It only borrows existing video streams; capture and signaling stay with calls.
export function createOfficeMediaSources(env) {
  const listeners = new Set();
  let revision = 0;
  let cleared = false;
  let notifying = false;
  const empty = () => Object.freeze({
    revision,
    sessionId: null,
    participants: Object.freeze([]),
    sources: Object.freeze([]),
  });
  let snapshot = empty();
  let publishedRevision = revision;

  function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  function avatar(value) {
    if (typeof value !== 'string' || /[\\\s%?#]/.test(value)) return null;
    const origin = env.window.location?.origin;
    if (!origin || value.split('/').some(part => part === '.' || part === '..')) return null;
    try {
      const url = new URL(value, origin);
      if (url.origin !== origin || url.username || url.password || url.search || url.hash) return null;
      if (!/^\/api\/office\/runtime\/assets\/[a-zA-Z0-9_./-]+\.png$/.test(url.pathname)) return null;
      if (url.pathname.split('/').some((part, index) => index > 0 && !part)) return null;
      return url.pathname;
    } catch {
      return null;
    }
  }

  function usable(stream) {
    return !!stream && typeof stream.getVideoTracks === 'function'
      && stream.getVideoTracks().some(track => track?.readyState === 'live' && !track.muted);
  }

  function read() {
    const win = env.window;
    const self = env.getState()?.data?.user;
    const selfId = text(self?.id);
    if (win.aureonOfficeBootstrap?.active !== true || !selfId || self.status === 'offline') return null;
    const meeting = env.getMeeting();
    const sessionId = text(meeting?.id);
    if (!sessionId || meeting.phase === 'completed' || !Array.isArray(meeting.members)
      || !meeting.members.includes(selfId)) return null;

    const participants = [];
    const sources = [];
    const members = new Set(meeting.members.filter(id => text(id) === id));
    const currentRoom = env.getRoomId() === sessionId && !!text(env.getCallId());
    for (const id of members) {
      const isSelf = id === selfId;
      const details = env.person(id) || (isSelf ? self : null);
      const name = text(details?.name) || (isSelf ? 'Você' : 'Participante');
      participants.push({id, name, isSelf, avatarUrl: avatar(details?.avatarUrl)});
      const peer = !isSelf && currentRoom ? env.getPeer(id) : null;
      const admittedPeer = peer && peer.id === id && !!text(peer.callId) ? peer : null;
      const screen = isSelf ? win.aureonScreenStream?.() : admittedPeer?.screen;
      const camera = isSelf
        ? self.preferences?.hideSelf === true ? null : win.aureonCameraStream?.()
        : admittedPeer?.camera;
      for (const [kind, stream] of [['screen', screen], ['camera', camera]]) {
        if (usable(stream)) sources.push({
          id: sessionId + ':' + id + ':' + kind,
          kind,
          participantId: id,
          label: (kind === 'screen' ? 'Tela de ' : 'Câmera de ') + name,
          isSelf,
          stream,
        });
      }
    }
    return {sessionId, participants, sources};
  }

  function same(next) {
    if (!next) return snapshot.sessionId === null;
    if (snapshot.sessionId !== next.sessionId || snapshot.participants.length !== next.participants.length
      || snapshot.sources.length !== next.sources.length) return false;
    return next.participants.every((person, index) => {
      const previous = snapshot.participants[index];
      return person.id === previous.id && person.name === previous.name
        && person.isSelf === previous.isSelf && person.avatarUrl === previous.avatarUrl;
    }) && next.sources.every((source, index) => {
      const previous = snapshot.sources[index];
      return source.id === previous.id && source.label === previous.label
        && source.isSelf === previous.isSelf && source.stream === previous.stream;
    });
  }

  function replace(next) {
    if (same(next)) return snapshot;
    revision += 1;
    snapshot = next ? Object.freeze({
      revision,
      sessionId: next.sessionId,
      participants: Object.freeze(next.participants.map(person => Object.freeze(person))),
      sources: Object.freeze(next.sources.map(source => Object.freeze(source))),
    }) : empty();
    return snapshot;
  }

  function getSnapshot() {
    if (cleared) return snapshot;
    try {
      return replace(read());
    } catch {
      // Unavailable state, metadata, or tracks cannot retain authorized media.
      return replace(null);
    }
  }

  function notify() {
    if (notifying || publishedRevision === snapshot.revision) return;
    publishedRevision = snapshot.revision;
    notifying = true;
    try {
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue;
        try { listener(); } catch { /* A consumer cannot break calls or another consumer. */ }
      }
    } finally {
      notifying = false;
    }
  }

  function publish() {
    cleared = false;
    getSnapshot();
    notify();
    return snapshot;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('A media source subscriber must be a function');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function clear() {
    // Explicit publish reopens this presentation cache for the next calls update.
    // No stream, track, or meeting state is owned or modified by this bridge.
    cleared = true;
    replace(null);
    notify();
    return snapshot;
  }

  return Object.freeze({getSnapshot, subscribe, publish, clear});
}
