// Serialized into the CRM runtime. Keep this factory independent of module scope.
export function createOfficePresentation({window, document}) {
  const records = new Map();
  let started = false, destroyed = false, queued = false, observer = null;
  let style = null, dialog = null, surface = null, viewer = null, heading = null, status = null;
  let minimize = null, fullscreen = null, current = null, returnFocus = null;
  let version = 0;
  const listeners = [];

  function listen(target, type, listener) {
    target.addEventListener(type, listener);
    listeners.push(() => target.removeEventListener(type, listener));
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function action(label, handler) {
    const button = element('button', '', label);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  }
  function setHidden(node, hidden) {
    if (node.hidden !== hidden) node.hidden = hidden;
  }
  function concealed(record) {
    if (!record.video.isConnected) return true;
    for (let node = record.video; node && node !== document.body; node = node.parentElement) {
      // This module hides the wrapper when its source has no stream. It must not
      // mistake that temporary wrapper state for the application's visibility.
      if (node === record.wrapper) continue;
      if (node.hidden) return true;
      const computed = window.getComputedStyle?.(node);
      if (computed?.display === 'none' || computed?.visibility === 'hidden') return true;
    }
    return false;
  }
  function source(record) {
    const stream = record.video.srcObject;
    if (stream) {
      const tracks = typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks() : [];
      return tracks.some(track => track.readyState === 'live') ? {stream, url: ''} : null;
    }
    const url = record.video.currentSrc || record.video.getAttribute('src');
    return url && !record.video.ended ? {stream: null, url} : null;
  }
  function label(record) {
    return record.local ? 'Seu compartilhamento' :
      record.tile.querySelector('small')?.textContent?.trim() ||
      record.video.getAttribute('aria-label') || 'Tela compartilhada';
  }
  function play(video) {
    try { video.play()?.catch(() => {}); } catch {}
  }
  function clearViewer() {
    try { viewer?.pause(); } catch {}
    if (viewer) {
      viewer.srcObject = null;
      viewer.removeAttribute('src');
      try { viewer.load(); } catch {}
    }
  }
  function exitFullscreen() {
    if (document.fullscreenElement === surface) {
      try { document.exitFullscreen()?.catch(() => {}); } catch {}
    }
  }
  function close() {
    if (!dialog) return;
    const trigger = returnFocus;
    version++;
    current = null;
    returnFocus = null;
    exitFullscreen();
    if (dialog.open) dialog.close();
    clearViewer();
    status.textContent = '';
    if (trigger?.isConnected && !trigger.closest('[hidden]')) trigger.focus();
  }
  function syncViewer(record, media) {
    const nextLabel = label(record);
    if (heading.textContent !== nextLabel) heading.textContent = nextLabel;
    viewer.setAttribute('aria-label', nextLabel);
    if (media.stream) {
      if (viewer.srcObject !== media.stream) {
        viewer.removeAttribute('src');
        viewer.srcObject = media.stream;
        play(viewer);
      }
    } else if (viewer.getAttribute('src') !== media.url || viewer.srcObject) {
      viewer.srcObject = null;
      viewer.setAttribute('src', media.url);
      play(viewer);
    }
  }
  function open(record) {
    const media = source(record);
    if (destroyed || concealed(record) || !media) return;
    current = record;
    version++;
    returnFocus = record.button;
    status.textContent = '';
    syncViewer(record, media);
    if (!dialog.open) dialog.showModal();
    minimize.focus();
  }
  function fullscreenLabel() {
    fullscreen.textContent = document.fullscreenElement === surface ? 'Sair da tela cheia' : 'Tela cheia';
  }
  async function toggleFullscreen() {
    if (!current) return;
    const requestedVersion = version;
    status.textContent = '';
    try {
      if (document.fullscreenElement === surface) await document.exitFullscreen();
      else if (typeof surface.requestFullscreen === 'function') await surface.requestFullscreen();
      else throw new Error('Fullscreen unavailable');
      if (requestedVersion !== version) exitFullscreen();
    } catch {
      if (current && requestedVersion === version) status.textContent = 'Não foi possível abrir em tela cheia. Você pode continuar na janela ampliada.';
    }
    fullscreenLabel();
  }
  function createDialog() {
    dialog = element('dialog', 'aureon-presentation');
    dialog.setAttribute('aria-labelledby', 'aureon-presentation-title');
    // Fullscreen deliberately targets a section. The Fullscreen API rejects a
    // dialog element even when it is already open as a modal.
    surface = element('section', 'aureon-presentation-content');
    const bar = element('header', 'aureon-presentation-bar');
    heading = element('h2');
    heading.id = 'aureon-presentation-title';
    const controls = element('div', 'aureon-presentation-controls');
    fullscreen = action('Tela cheia', toggleFullscreen);
    minimize = action('Minimizar', close);
    controls.append(fullscreen, minimize);
    bar.append(heading, controls);
    viewer = element('video', 'aureon-presentation-video');
    viewer.autoplay = true;
    viewer.muted = true;
    viewer.playsInline = true;
    status = element('p', 'aureon-presentation-status');
    status.setAttribute('role', 'status');
    surface.append(bar, viewer, status);
    dialog.append(surface);
    document.body.append(dialog);
    listen(dialog, 'cancel', event => { event.preventDefault(); close(); });
    listen(dialog, 'close', () => { if (current) close(); });
    listen(document, 'fullscreenchange', fullscreenLabel);
  }
  function watchStream(record) {
    const stream = record.video.srcObject;
    const tracks = typeof stream?.getVideoTracks === 'function' ? stream.getVideoTracks() : [];
    if (record.stream === stream && record.tracks.length === tracks.length &&
      record.tracks.every((track, index) => track === tracks[index])) return;
    record.unwatch.forEach(remove => remove());
    record.unwatch = [];
    record.stream = stream;
    record.tracks = tracks;
    for (const target of [stream, ...tracks]) {
      if (!target?.addEventListener) continue;
      for (const type of target === stream ? ['addtrack', 'removetrack'] : ['ended']) {
        target.addEventListener(type, schedule);
        record.unwatch.push(() => target.removeEventListener(type, schedule));
      }
    }
  }
  function attach(video, tile, local) {
    if (records.has(video)) return;
    const record = {video, tile, local, wrapper: null, button: null, stream: null, tracks: [], unwatch: [], mediaListeners: []};
    const bar = element('div', 'aureon-screen-actions');
    if (local) {
      const wrapper = element('section', 'aureon-screen-preview');
      video.parentNode.insertBefore(wrapper, video);
      wrapper.append(video);
      record.wrapper = wrapper;
      bar.append(element('span', '', 'Seu compartilhamento'));
      wrapper.append(bar);
    } else tile.append(bar);
    record.bar = bar;
    record.button = action('Ampliar compartilhamento', () => open(record));
    record.button.setAttribute('aria-haspopup', 'dialog');
    bar.append(record.button);
    for (const type of ['loadedmetadata', 'loadeddata', 'emptied', 'ended', 'play']) {
      const changed = () => {
        if ((type === 'emptied' || type === 'ended') && current === record) close();
        schedule();
      };
      video.addEventListener(type, changed);
      record.mediaListeners.push(() => video.removeEventListener(type, changed));
    }
    records.set(video, record);
  }
  function detach(record) {
    if (current === record) close();
    record.unwatch.forEach(remove => remove());
    record.mediaListeners.forEach(remove => remove());
    record.bar.remove();
    if (record.wrapper) {
      if (record.wrapper.isConnected && record.video.parentNode === record.wrapper) {
        record.wrapper.parentNode.insertBefore(record.video, record.wrapper);
      }
      record.wrapper.remove();
    }
    records.delete(record.video);
  }
  function refresh() {
    queued = false;
    if (!started || destroyed) return;
    const local = document.getElementById('screenPreview');
    if (local?.tagName === 'VIDEO') attach(local, null, true);
    for (const video of document.querySelectorAll('.r-screen-tile video')) {
      attach(video, video.closest('.r-screen-tile'), false);
    }
    for (const record of records.values()) {
      if (!record.video.isConnected || (!record.local && !record.tile.isConnected)) { detach(record); continue; }
      watchStream(record);
      const media = source(record), unavailable = concealed(record) || !media;
      setHidden(record.wrapper || record.bar, unavailable);
      if (current === record) {
        if (unavailable) close();
        else syncViewer(record, media);
      }
    }
  }
  function schedule() {
    if (queued || !started || destroyed) return;
    queued = true;
    window.queueMicrotask(refresh);
  }
  function relevant(recordsChanged) {
    return recordsChanged.some(change => {
      const target = change.target;
      if (target === style || target === dialog || dialog?.contains(target) || target.closest?.('svg')) return false;
      if (change.type === 'attributes') {
        for (const record of records.values()) {
          if (target === record.wrapper || target === record.bar || record.bar.contains(target)) continue;
          if (target === record.video || target.contains?.(record.video)) return true;
        }
        return false;
      }
      for (const node of [...change.addedNodes, ...change.removedNodes]) {
        if (node === dialog || node === style || node.classList?.contains('aureon-screen-actions')) continue;
        if (node.nodeType !== 1 || node.namespaceURI === 'http://www.w3.org/2000/svg') continue;
        if (node.id === 'screenPreview' || node.matches?.('.r-screen-tile, .r-screen-tile video') ||
          node.querySelector?.('#screenPreview, .r-screen-tile')) return true;
        for (const record of records.values()) if (node === record.video || node.contains?.(record.video)) return true;
      }
      return false;
    });
  }
  function start() {
    if (started || destroyed) return;
    started = true;
    style = element('style');
    style.textContent = `
.aureon-screen-preview{position:fixed;right:25px;bottom:110px;width:min(320px,calc(100vw - 24px));border:2px solid var(--violet,#8f6bea);border-radius:12px;overflow:hidden;background:#171922;z-index:12;box-shadow:0 8px 30px #0004}
.aureon-screen-preview #screenPreview{position:static!important;display:block;width:100%!important;max-width:100%;max-height:30dvh;border:0;border-radius:0;object-fit:contain;background:#0b0c11;image-rendering:auto!important}
.aureon-screen-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 9px;background:#24242c;color:#f0f1f6;font:inherit}
.aureon-screen-actions span{font-size:11px;min-width:0}.aureon-screen-actions button{font:inherit;font-size:11px;padding:6px 8px;line-height:1.3;border:1px solid #545064;border-radius:7px;background:#342b49;color:#f0f1f6;white-space:normal}
.r-screen-tile>.aureon-screen-actions{justify-content:flex-end}.aureon-screen-actions button:hover{background:#47316d}
dialog.aureon-presentation{box-sizing:border-box;width:calc(100vw - 32px);height:calc(100dvh - 32px);max-width:1800px;max-height:calc(100dvh - 32px);padding:0;border:1px solid #545064;border-radius:14px;background:#171922;color:#f0f1f6;overflow:hidden;font:inherit}
dialog.aureon-presentation[open]{display:flex;flex-direction:column;gap:0}dialog.aureon-presentation::backdrop{background:#070a12db}
.aureon-presentation-content{display:flex;flex:1;flex-direction:column;min-height:0;min-width:0;background:#171922}
.aureon-presentation-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-shrink:0;padding:12px 16px;background:#24242c;border-bottom:1px solid #3b3b47}
.aureon-presentation-bar h2{min-width:0;margin:0;font:inherit;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.aureon-presentation-controls{display:flex;gap:8px;flex-shrink:0}.aureon-presentation-controls button{font:inherit;font-size:12px;line-height:1.3;padding:8px 12px;background:#342b49;border:1px solid #545064;border-radius:8px;color:#f0f1f6}
.aureon-presentation-controls button:hover{background:#47316d}.aureon-presentation button:focus-visible,.aureon-screen-actions button:focus-visible{outline:2px solid #bfa5ff;outline-offset:2px}
.aureon-presentation-video{display:block;flex:1;width:100%;min-height:0;object-fit:contain;background:#08090c;image-rendering:auto!important}
.aureon-presentation-status{flex-shrink:0;margin:0;padding:0 16px;color:#c5bfd5;font-size:12px;line-height:1.5}.aureon-presentation-status:not(:empty){padding:9px 16px}
.aureon-presentation-content:fullscreen{width:100vw;height:100dvh;max-width:none;max-height:none;border:0;border-radius:0}
@media(max-width:600px){.aureon-screen-preview{right:12px;bottom:88px}.aureon-screen-actions{gap:5px}.aureon-screen-actions span{font-size:10px}.aureon-screen-actions button{font-size:10px}dialog.aureon-presentation{width:calc(100vw - 12px);height:calc(100dvh - 12px);max-height:calc(100dvh - 12px);border-radius:10px}.aureon-presentation-bar{align-items:flex-start;gap:8px;padding:10px;flex-direction:column}.aureon-presentation-bar h2{max-width:100%;font-size:13px}.aureon-presentation-controls{width:100%;justify-content:flex-end}.aureon-presentation-controls button{padding:7px 10px}}
`;
    document.head.append(style);
    createDialog();
    observer = new window.MutationObserver(changes => { if (relevant(changes)) schedule(); });
    observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'class', 'src']});
    listen(window, 'aureon-interface-state', schedule);
    listen(window, 'aureon-office-session-ended', close);
    listen(window, 'pagehide', close);
    refresh();
  }
  function destroy() {
    if (destroyed) return;
    close();
    destroyed = true;
    observer?.disconnect();
    listeners.splice(0).forEach(remove => remove());
    for (const record of records.values()) detach(record);
    dialog?.remove();
    style?.remove();
    started = false;
  }
  return {start, close, destroy};
}
