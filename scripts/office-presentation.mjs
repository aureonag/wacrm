// Serialized into the CRM runtime. Keep this factory independent of module scope.
export function createOfficePresentation({window, document, mediaSources}) {
  const records = new Map();
  let started = false, destroyed = false, queued = false, observer = null, inputPrepared = false;
  let style = null, dialog = null, surface = null, viewer = null, heading = null, status = null;
  let minimize = null, fullscreen = null, current = null, returnFocus = null;
  let version = 0, gesture = null, resizeObserver = null;
  let callOpen = false, callSession = null, selectedScreen = null, callMode = 'gallery';
  let snapshot = null, unsubscribeSources = null, callLauncher = null;
  let modeBar = null, galleryButton = null, presenterButton = null, sourceSelect = null;
  let body = null, focusPane = null, gallery = null, participantsRail = null;
  const galleryCards = new Map(), railCards = new Map(), sourceWatches = new Map();
  const listeners = [];
  const watchedLayout = new Set();
  const layoutSelector = '.map-viewport, .office-map-nav, .call-dock, .dock-room, .sidebar, .rail';
  const gap = 12;

  function listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    listeners.push(() => target.removeEventListener(type, listener, options));
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
  function rectangle(node) {
    if (!node?.isConnected || node.hidden) return null;
    const computed = window.getComputedStyle?.(node);
    if (computed?.display === 'none' || computed?.visibility === 'hidden') return null;
    const rect = node.getBoundingClientRect?.();
    return rect && rect.width > 0 && rect.height > 0 ?
      {left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height} : null;
  }
  function intersects(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }
  function box(left, top, width, height) {
    return {left, top, width, height, right: left + width, bottom: top + height};
  }
  function layoutSpace() {
    const width = Math.max(1, Number(window.innerWidth) || 1024), height = Math.max(1, Number(window.innerHeight) || 768);
    const map = rectangle(document.querySelector('.map-viewport'));
    const left = Math.max(0, map?.left || 0), top = Math.max(0, map?.top || 0);
    const right = Math.min(width, map?.right ?? width), bottom = Math.min(height, map?.bottom ?? height);
    const inset = Math.min(gap, Math.max(0, (right - left) / 8), Math.max(0, (bottom - top) / 8));
    const bounds = box(left + inset, top + inset, Math.max(1, right - left - inset * 2), Math.max(1, bottom - top - inset * 2));
    const obstacles = [];
    for (const node of document.querySelectorAll('.office-map-nav, .call-dock, .dock-room, .sidebar, .rail')) {
      const rect = rectangle(node);
      if (rect && intersects(rect, bounds)) obstacles.push(box(rect.left - gap, rect.top - gap, rect.width + gap * 2, rect.height + gap * 2));
    }
    return {bounds, obstacles};
  }
  function freeRegions(bounds, obstacles) {
    let regions = [bounds];
    for (const obstacle of obstacles) {
      const remaining = [];
      for (const region of regions) {
        if (!intersects(region, obstacle)) { remaining.push(region); continue; }
        if (obstacle.left > region.left) remaining.push(box(region.left, region.top, obstacle.left - region.left, region.height));
        if (obstacle.right < region.right) remaining.push(box(obstacle.right, region.top, region.right - obstacle.right, region.height));
        if (obstacle.top > region.top) remaining.push(box(region.left, region.top, region.width, obstacle.top - region.top));
        if (obstacle.bottom < region.bottom) remaining.push(box(region.left, obstacle.bottom, region.width, region.bottom - obstacle.bottom));
      }
      regions = remaining.filter((region, index) => !remaining.some((other, otherIndex) =>
        otherIndex !== index && (otherIndex < index || other.width > region.width || other.height > region.height) &&
        other.left <= region.left && other.top <= region.top && other.right >= region.right && other.bottom >= region.bottom));
    }
    return regions;
  }
  function fit(preferred, space) {
    const regions = freeRegions(space.bounds, space.obstacles);
    const minimumWidth = Math.min(240, space.bounds.width), minimumHeight = Math.min(144, space.bounds.height);
    let usable = regions.filter(region => region.width >= minimumWidth && region.height >= minimumHeight);
    if (!usable.length) usable = regions;
    let result = null, best = Infinity;
    for (const region of usable) {
      const width = Math.min(region.width, Math.max(Math.min(minimumWidth, region.width), preferred.width));
      const height = Math.min(region.height, Math.max(Math.min(minimumHeight, region.height), preferred.height));
      const left = Math.max(region.left, Math.min(region.right - width, preferred.left));
      const top = Math.max(region.top, Math.min(region.bottom - height, preferred.top));
      const sizeLoss = Math.abs(width - preferred.width) + Math.abs(height - preferred.height);
      const score = sizeLoss * 10000 + (left - preferred.left) ** 2 + (top - preferred.top) ** 2;
      if (score < best) { best = score; result = box(left, top, width, height); }
    }
    return result;
  }
  function applyBox(record, next) {
    if (!next) return false;
    record.box = next;
    for (const key of ['left', 'top', 'width', 'height']) {
      const value = Math.round(next[key] * 100) / 100 + 'px';
      if (record.wrapper.style[key] !== value) record.wrapper.style[key] = value;
    }
    return true;
  }
  function positionMini(record) {
    const space = layoutSpace(), bounds = space.bounds;
    let preferred = record.box;
    if (!preferred || !record.manipulated) {
      const width = Math.min(320, bounds.width);
      const ratio = record.video.videoWidth > 0 && record.video.videoHeight > 0 ? record.video.videoWidth / record.video.videoHeight : 16 / 9;
      const height = Math.min(bounds.height, width / ratio + 44);
      const nav = rectangle(document.querySelector('.office-map-nav'));
      preferred = box(nav ? nav.left - gap - width : bounds.right - width, bounds.bottom - height, width, height);
    } else if (record.bounds && !gesture) {
      const previous = record.bounds;
      if (previous.left !== bounds.left || previous.top !== bounds.top || previous.width !== bounds.width || previous.height !== bounds.height) {
        const x = (preferred.left - previous.left) / Math.max(1, previous.width - preferred.width);
        const y = (preferred.top - previous.top) / Math.max(1, previous.height - preferred.height);
        preferred = box(bounds.left + Math.max(0, Math.min(1, x)) * Math.max(0, bounds.width - preferred.width),
          bounds.top + Math.max(0, Math.min(1, y)) * Math.max(0, bounds.height - preferred.height), preferred.width, preferred.height);
      }
    }
    record.bounds = bounds;
    return applyBox(record, fit(preferred, space));
  }
  function finishGesture(cancel = false) {
    if (!gesture) return;
    const previous = gesture;
    gesture = null;
    if (cancel) applyBox(previous.record, fit(previous.original, layoutSpace()));
    previous.record.wrapper.classList.remove('is-moving');
    try { if (previous.target.hasPointerCapture?.(previous.pointerId)) previous.target.releasePointerCapture(previous.pointerId); } catch {}
  }
  function beginGesture(record, edge, event) {
    if (event.isPrimary === false || (event.button !== undefined && event.button !== 0) || !record.box) return;
    if (!edge && event.target.closest('button')) return;
    event.preventDefault(); event.stopPropagation();
    finishGesture();
    record.manipulated = true;
    gesture = {record, edge, target: event.currentTarget, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, original: {...record.box}};
    record.wrapper.classList.add('is-moving');
    try { gesture.target.setPointerCapture(event.pointerId); } catch {}
  }
  function resized(original, edge, dx, dy) {
    const minimum = layoutSpace().bounds;
    const minWidth = Math.min(240, minimum.width), minHeight = Math.min(144, minimum.height);
    let left = original.left, top = original.top, right = original.right, bottom = original.bottom;
    if (edge.includes('e')) right = Math.max(left + minWidth, right + dx);
    if (edge.includes('w')) left = Math.min(right - minWidth, left + dx);
    if (edge.includes('s')) bottom = Math.max(top + minHeight, bottom + dy);
    if (edge.includes('n')) top = Math.min(bottom - minHeight, top + dy);
    return box(left, top, right - left, bottom - top);
  }
  function moveGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const {record, edge, original} = gesture, dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    const preferred = edge ? resized(original, edge, dx, dy) : box(original.left + dx, original.top + dy, original.width, original.height);
    applyBox(record, fit(preferred, layoutSpace()));
  }
  function keyboardMove(record, edge, event) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || !record.box) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 40 : 10, dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    record.manipulated = true;
    const preferred = edge ? resized(record.box, edge, dx, dy) : box(record.box.left + dx, record.box.top + dy, record.box.width, record.box.height);
    applyBox(record, fit(preferred, layoutSpace()));
  }
  function attachMiniControls(record) {
    function on(target, type, callback) {
      target.addEventListener(type, callback);
      record.mediaListeners.push(() => target.removeEventListener(type, callback));
    }
    record.bar.tabIndex = 0;
    record.bar.setAttribute('role', 'group');
    record.bar.setAttribute('aria-label', 'Mover compartilhamento. Use as setas; Shift move mais rápido.');
    on(record.wrapper, 'pointerdown', event => { beginGesture(record, '', event); event.stopPropagation(); });
    on(record.wrapper, 'click', event => event.stopPropagation());
    const labels = {n: 'borda superior', e: 'borda direita', s: 'borda inferior', w: 'borda esquerda',
      ne: 'canto superior direito', nw: 'canto superior esquerdo', se: 'canto inferior direito', sw: 'canto inferior esquerdo'};
    for (const [edge, text] of Object.entries(labels)) {
      const handle = element('button', 'aureon-screen-resize aureon-screen-resize-' + edge);
      handle.setAttribute('data-aureon-resize', edge);
      handle.type = 'button'; handle.setAttribute('aria-label', 'Redimensionar compartilhamento ' + (edge.length === 1 ? 'pela ' : 'pelo ') + text + '. Use as setas.');
      handle.title = 'Arraste para redimensionar';
      on(handle, 'pointerdown', event => beginGesture(record, edge, event));
      on(handle, 'lostpointercapture', () => { if (gesture?.record === record) finishGesture(); });
      record.wrapper.append(handle);
    }
    on(record.wrapper, 'lostpointercapture', () => { if (gesture?.record === record) finishGesture(); });
  }
  function watchLayout() {
    if (!resizeObserver) return;
    const next = new Set(document.querySelectorAll(layoutSelector));
    for (const node of watchedLayout) if (!next.has(node)) { resizeObserver.unobserve(node); watchedLayout.delete(node); }
    for (const node of next) if (!watchedLayout.has(node)) { resizeObserver.observe(node); watchedLayout.add(node); }
  }
  function prepareInput() {
    if (inputPrepared || destroyed) return;
    inputPrepared = true;
    // Install before the legacy map bundle's capture listener so a focused
    // preview cannot move the avatar when its keyboard handles use the arrows.
    listen(window, 'keydown', event => {
      if (!started || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const wrapper = event.target?.closest?.('.aureon-screen-preview');
      if (!wrapper) return;
      for (const record of records.values()) if (record.wrapper === wrapper) {
        event.preventDefault(); event.stopImmediatePropagation();
        const handle = event.target.closest('.aureon-screen-resize');
        if (handle) keyboardMove(record, handle.getAttribute('data-aureon-resize'), event);
        else if (event.target === record.bar) keyboardMove(record, '', event);
        return;
      }
    }, true);
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
  function liveVideo(stream) {
    try { return !!stream?.getVideoTracks().some(track => track.readyState === 'live' && !track.muted); }
    catch { return false; }
  }
  function readSources() {
    if (!mediaSources) return null;
    try {
      const value = mediaSources.getSnapshot();
      if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
        !(value.sessionId === null || typeof value.sessionId === 'string' && value.sessionId) ||
        !Array.isArray(value.participants) || !Array.isArray(value.sources)) return null;
      const people = new Map();
      for (const person of value.participants) {
        if (!person || typeof person.id !== 'string' || !person.id || typeof person.name !== 'string' ||
          typeof person.isSelf !== 'boolean' || people.has(person.id)) return null;
        people.set(person.id, person);
      }
      const sources = [], ids = new Set();
      for (const item of value.sources) {
        const person = people.get(item?.participantId);
        if (!person || !['screen', 'camera'].includes(item.kind) || typeof item.id !== 'string' ||
          typeof item.label !== 'string' || item.isSelf !== person.isSelf || ids.has(item.id) ||
          typeof item.stream?.getVideoTracks !== 'function') return null;
        if (item.id !== value.sessionId + ':' + item.participantId + ':' + item.kind) return null;
        ids.add(item.id);
        sources.push(item);
      }
      // A null meeting never authorizes remote roster or media from old DOM.
      if (value.sessionId === null) return {revision: value.revision, sessionId: null, participants: [], sources: []};
      return {revision: value.revision, sessionId: value.sessionId, participants: [...people.values()], sources};
    } catch { return null; }
  }
  function clearVideo(video) {
    try { video.pause(); } catch {}
    video.srcObject = null;
    video.removeAttribute('src');
  }
  function clearCards(cards) {
    for (const card of cards.values()) { clearVideo(card.video); card.node.remove(); }
    cards.clear();
  }
  function watchSources(value) {
    const streams = new Set(value?.sessionId ? value.sources.map(item => item.stream) : []);
    for (const [stream, record] of sourceWatches) if (!streams.has(stream)) {
      record.remove.forEach(remove => remove()); sourceWatches.delete(stream);
    }
    for (const stream of streams) {
      let tracks;
      try { tracks = stream.getVideoTracks(); } catch { continue; }
      const previous = sourceWatches.get(stream);
      if (previous && previous.tracks.length === tracks.length && previous.tracks.every((track, index) => track === tracks[index])) continue;
      previous?.remove.forEach(remove => remove());
      const remove = [];
      for (const target of [stream, ...tracks]) if (target?.addEventListener) {
        for (const type of target === stream ? ['addtrack', 'removetrack'] : ['ended', 'mute', 'unmute']) {
          target.addEventListener(type, schedule);
          remove.push(() => target.removeEventListener(type, schedule));
        }
      }
      sourceWatches.set(stream, {tracks, remove});
    }
  }
  function initials(name) {
    return name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || '?';
  }
  function syncCards(container, cards, descriptions) {
    const wanted = new Set(descriptions.map(item => item.id));
    for (const [id, card] of cards) if (!wanted.has(id)) { clearVideo(card.video); card.node.remove(); cards.delete(id); }
    descriptions.forEach((item, index) => {
      let card = cards.get(item.id);
      if (!card) {
        const node = element(item.screenId ? 'button' : 'div', 'aureon-media-card' + (item.screenId ? ' aureon-media-screen' : ''));
        if (item.screenId) {
          node.type = 'button';
          node.addEventListener('click', () => { selectedScreen = item.screenId; callMode = 'presenter'; renderCall(); });
        }
        const video = element('video'); video.autoplay = true; video.muted = true; video.playsInline = true;
        const avatar = element('div', 'aureon-media-avatar'), image = element('img'), fallback = element('span');
        image.alt = ''; image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => { card.failedAvatar = card.avatarUrl; setHidden(image, true); setHidden(fallback, false); });
        avatar.append(image, fallback);
        const caption = element('div', 'aureon-media-caption');
        node.append(video, avatar, caption);
        card = {node, video, avatar, image, fallback, caption, avatarUrl: null};
        cards.set(item.id, card);
      }
      if (card.caption.textContent !== item.label) card.caption.textContent = item.label;
      card.node.setAttribute('aria-label', item.screenId ? 'Apresentar ' + item.label : item.label);
      card.video.setAttribute('aria-label', item.label);
      const ready = liveVideo(item.stream);
      setHidden(card.video, !ready); setHidden(card.avatar, ready);
      if (ready && card.video.srcObject !== item.stream) { card.video.srcObject = item.stream; play(card.video); }
      else if (!ready && card.video.srcObject) clearVideo(card.video);
      const avatarUrl = typeof item.avatarUrl === 'string' && item.avatarUrl ? item.avatarUrl : null;
      if (card.avatarUrl !== avatarUrl) {
        card.avatarUrl = avatarUrl;
        if (avatarUrl) card.image.setAttribute('src', avatarUrl); else card.image.removeAttribute('src');
      }
      const showImage = !!avatarUrl && card.failedAvatar !== avatarUrl;
      setHidden(card.image, !showImage); setHidden(card.fallback, showImage);
      const text = initials(item.name || item.label);
      if (card.fallback.textContent !== text) card.fallback.textContent = text;
      const at = container.children[index];
      if (at !== card.node) { if (at) container.insertBefore(card.node, at); else container.append(card.node); }
    });
  }
  function renderCall() {
    if (!callOpen || !snapshot?.sessionId) return;
    const screens = snapshot.sources.filter(item => item.kind === 'screen' && liveVideo(item.stream));
    if (!screens.some(item => item.id === selectedScreen)) selectedScreen = screens[0]?.id || null;
    if (!selectedScreen) callMode = 'gallery';
    const selected = screens.find(item => item.id === selectedScreen);
    const people = snapshot.participants.map(person => ({
      id: 'person:' + person.id, name: person.name, label: person.name + (person.isSelf ? ' (você)' : ''), avatarUrl: person.avatarUrl,
      stream: snapshot.sources.find(item => item.kind === 'camera' && item.participantId === person.id)?.stream || null,
    }));
    const nextOptions = screens.map(item => [item.id, item.label]);
    const signature = JSON.stringify(nextOptions);
    if (sourceSelect.dataset.signature !== signature) {
      for (const option of [...sourceSelect.children]) option.remove();
      for (const [id, text] of nextOptions) { const option = element('option', '', text); option.value = id; sourceSelect.append(option); }
      sourceSelect.dataset.signature = signature;
    }
    sourceSelect.value = selectedScreen || '';
    sourceSelect.disabled = screens.length < 2;
    setHidden(sourceSelect.parentElement, screens.length === 0);
    galleryButton.setAttribute('aria-pressed', String(callMode === 'gallery'));
    presenterButton.setAttribute('aria-pressed', String(callMode === 'presenter'));
    presenterButton.disabled = !selected;
    setHidden(modeBar, false);
    setHidden(focusPane, callMode !== 'presenter');
    setHidden(participantsRail, callMode !== 'presenter');
    setHidden(gallery, callMode !== 'gallery');
    if (callMode === 'presenter' && selected) {
      body.classList.add('aureon-presenter-layout');
      clearCards(galleryCards);
      showViewer({stream: selected.stream, url: ''}, selected.label);
      syncCards(participantsRail, railCards, people);
    } else {
      body.classList.remove('aureon-presenter-layout');
      clearViewer(); clearCards(railCards);
      if (heading.textContent !== 'Galeria da chamada') heading.textContent = 'Galeria da chamada';
      syncCards(gallery, galleryCards, [...people, ...screens.map(item => ({id: 'screen:' + item.id, screenId: item.id, label: item.label, stream: item.stream}))]);
    }
  }
  function openCall(trigger, preferredSource) {
    if (!started || destroyed) return false;
    snapshot = readSources();
    if (!snapshot?.sessionId || !snapshot.participants.length) { if (callOpen) close(); return false; }
    watchSources(snapshot);
    if (callSession !== snapshot.sessionId) { selectedScreen = null; callMode = snapshot.sources.some(item => item.kind === 'screen' && liveVideo(item.stream)) ? 'presenter' : 'gallery'; }
    callSession = snapshot.sessionId;
    if (preferredSource) { selectedScreen = preferredSource; callMode = 'presenter'; }
    current = null; callOpen = true; version++;
    returnFocus = trigger?.focus ? trigger : document.activeElement;
    status.textContent = '';
    renderCall();
    if (!dialog.open) dialog.showModal();
    minimize.focus();
    return true;
  }
  function refreshSources() {
    if (!mediaSources) return;
    snapshot = readSources();
    const authorized = !!snapshot?.sessionId && snapshot.participants.length > 0;
    watchSources(authorized ? snapshot : null);
    if (callSession && callSession !== snapshot?.sessionId) {
      if (callOpen) close();
      callSession = null; selectedScreen = null; callMode = 'gallery';
    }
    if (callOpen) { if (authorized) renderCall(); else close(); }
    const host = authorized ? [...document.querySelectorAll('.r-call-tools'), ...document.querySelectorAll('.call-dock')].find(node => rectangle(node)) : null;
    if (!host) { callLauncher?.remove(); return; }
    if (!callLauncher) {
      callLauncher = action('Visualizar chamada', () => openCall(callLauncher));
      callLauncher.className = 'aureon-call-view-trigger';
      callLauncher.setAttribute('aria-label', 'Visualizar chamada'); callLauncher.setAttribute('aria-haspopup', 'dialog');
      callLauncher.title = 'Visualizar chamada';
    }
    const caption = host.matches('.call-dock') ? '▦' : 'Visualizar chamada';
    if (callLauncher.textContent !== caption) callLauncher.textContent = caption;
    if (callLauncher.parentElement !== host) host.append(callLauncher);
  }
  function clearCallView() {
    callOpen = false;
    clearCards(galleryCards); clearCards(railCards);
    if (!body) return;
    body.classList.remove('aureon-presenter-layout');
    setHidden(modeBar, true); setHidden(gallery, true); setHidden(participantsRail, true); setHidden(focusPane, false);
  }
  function clearViewer() {
    if (viewer && (viewer.srcObject || viewer.getAttribute('src'))) {
      try { viewer.pause(); } catch {}
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
    finishGesture();
    const trigger = returnFocus;
    version++;
    current = null;
    clearCallView();
    returnFocus = null;
    exitFullscreen();
    if (dialog.open) dialog.close();
    clearViewer();
    status.textContent = '';
    if (trigger?.isConnected && !trigger.closest('[hidden]')) trigger.focus();
  }
  function syncViewer(record, media) {
    showViewer(media, label(record));
  }
  function showViewer(media, nextLabel) {
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
    if (mediaSources) {
      const value = readSources();
      const item = value?.sessionId && value.sources.find(item => item.kind === 'screen' && item.stream === media.stream && liveVideo(item.stream));
      if (item) { openCall(record.button, item.id); return; }
      if (!record.local) return;
    }
    clearCallView();
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
    if (!current && !callOpen) return;
    const requestedVersion = version;
    status.textContent = '';
    try {
      if (document.fullscreenElement === surface) await document.exitFullscreen();
      else if (typeof surface.requestFullscreen === 'function') await surface.requestFullscreen();
      else throw new Error('Fullscreen unavailable');
      if (requestedVersion !== version) exitFullscreen();
    } catch {
      if ((current || callOpen) && requestedVersion === version) status.textContent = 'Não foi possível abrir em tela cheia. Você pode continuar na janela ampliada.';
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
    modeBar = element('div', 'aureon-presentation-modes');
    modeBar.setAttribute('aria-label', 'Visualização da chamada');
    galleryButton = action('Galeria', () => { callMode = 'gallery'; renderCall(); });
    presenterButton = action('Apresentador', () => { callMode = 'presenter'; renderCall(); });
    const choice = element('label', 'aureon-presentation-choice');
    choice.append(element('span', '', 'Tela em destaque'));
    sourceSelect = element('select');
    sourceSelect.setAttribute('aria-label', 'Tela em destaque');
    sourceSelect.addEventListener('change', () => { selectedScreen = sourceSelect.value; callMode = 'presenter'; renderCall(); });
    choice.append(sourceSelect);
    modeBar.append(galleryButton, presenterButton, choice);
    body = element('div', 'aureon-presentation-body');
    focusPane = element('div', 'aureon-presentation-focus');
    focusPane.append(viewer);
    gallery = element('div', 'aureon-presentation-gallery');
    gallery.setAttribute('aria-label', 'Galeria da chamada');
    participantsRail = element('div', 'aureon-presentation-participants');
    participantsRail.setAttribute('aria-label', 'Participantes da chamada');
    body.append(focusPane, gallery, participantsRail);
    clearCallView();
    status = element('p', 'aureon-presentation-status');
    status.setAttribute('role', 'status');
    surface.append(bar, modeBar, body, status);
    dialog.append(surface);
    document.body.append(dialog);
    listen(dialog, 'cancel', event => { event.preventDefault(); close(); });
    listen(dialog, 'close', () => { if (current || callOpen) close(); });
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
    if (local) attachMiniControls(record);
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
    if (gesture?.record === record) finishGesture();
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
    refreshSources();
    watchLayout();
    for (const record of records.values()) {
      if (!record.video.isConnected || (!record.local && !record.tile.isConnected)) { detach(record); continue; }
      watchStream(record);
      const media = source(record);
      const denied = mediaSources && !record.local && !(snapshot?.sessionId && snapshot.sources.some(item => item.kind === 'screen' && item.stream === media?.stream && liveVideo(item.stream)));
      const unavailable = concealed(record) || !media || denied;
      const noRoom = record.local && !unavailable && !positionMini(record);
      setHidden(record.wrapper || record.bar, unavailable || noRoom);
      if ((unavailable || noRoom) && gesture?.record === record) finishGesture();
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
        if (target.matches?.(layoutSelector)) return true;
        for (const record of records.values()) {
          if (target === record.wrapper || target === record.bar || record.bar.contains(target)) continue;
          if (target === record.video || target.contains?.(record.video)) return true;
        }
        return false;
      }
      for (const node of [...change.addedNodes, ...change.removedNodes]) {
        if (node === dialog || node === style || node.classList?.contains('aureon-screen-actions') || node === callLauncher) continue;
        if (node.nodeType !== 1 || node.namespaceURI === 'http://www.w3.org/2000/svg') continue;
        if (node.matches?.(layoutSelector + ', .r-call-tools') || node.querySelector?.(layoutSelector + ', .r-call-tools')) return true;
        if (node.id === 'screenPreview' || node.matches?.('.r-screen-tile, .r-screen-tile video') ||
          node.querySelector?.('#screenPreview, .r-screen-tile')) return true;
        for (const record of records.values()) if (node === record.video || node.contains?.(record.video)) return true;
      }
      return false;
    });
  }
  function start() {
    if (started || destroyed) return;
    prepareInput();
    started = true;
    style = element('style');
    style.textContent = `
.aureon-screen-preview{box-sizing:border-box;position:fixed;right:auto;bottom:auto;display:flex;flex-direction:column;width:320px;height:224px;border:2px solid var(--violet,#8f6bea);border-radius:12px;overflow:hidden;background:#171922;z-index:12;box-shadow:0 8px 30px #0004;touch-action:none;user-select:none;cursor:grab}
.aureon-screen-preview #screenPreview{position:static!important;z-index:0!important;display:block;flex:1;min-height:0;height:0;width:100%!important;max-width:100%;max-height:none;border:0;border-radius:0;object-fit:contain;background:#0b0c11;image-rendering:auto!important}
.aureon-screen-preview>.aureon-screen-actions{order:-1;flex-shrink:0;cursor:grab;touch-action:none}.aureon-screen-preview.is-moving,.aureon-screen-preview.is-moving>.aureon-screen-actions{cursor:grabbing}
.aureon-screen-preview .aureon-screen-resize{position:absolute;z-index:3;width:12px;height:12px;margin:0;padding:0;border:0;border-radius:0;background:transparent;opacity:0;touch-action:none}.aureon-screen-preview:hover .aureon-screen-resize,.aureon-screen-resize:focus-visible{opacity:1}.aureon-screen-preview .aureon-screen-resize:focus-visible{outline:2px solid #bfa5ff;outline-offset:-2px;background:#8f6bea44}
.aureon-screen-resize-n,.aureon-screen-resize-s{left:12px;right:12px;width:auto!important;height:8px!important;cursor:ns-resize}.aureon-screen-resize-e,.aureon-screen-resize-w{top:12px;bottom:12px;width:8px!important;height:auto!important;cursor:ew-resize}.aureon-screen-resize-n,.aureon-screen-resize-ne,.aureon-screen-resize-nw{top:0}.aureon-screen-resize-s,.aureon-screen-resize-se,.aureon-screen-resize-sw{bottom:0}.aureon-screen-resize-e,.aureon-screen-resize-ne,.aureon-screen-resize-se{right:0}.aureon-screen-resize-w,.aureon-screen-resize-nw,.aureon-screen-resize-sw{left:0}.aureon-screen-resize-ne,.aureon-screen-resize-sw{cursor:nesw-resize}.aureon-screen-resize-nw,.aureon-screen-resize-se{cursor:nwse-resize}
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
.aureon-presentation-body{display:flex;flex:1;min-width:0;min-height:0;overflow:hidden}.aureon-presentation-focus{display:flex;flex:1;min-width:0;min-height:0;overflow:hidden}.aureon-presentation-focus>.aureon-presentation-video{height:100%;max-height:100%}
.aureon-presentation-modes{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 16px;background:#202129;border-bottom:1px solid #3b3b47;flex-shrink:0}.aureon-presentation-modes button,.aureon-presentation-modes select{font:inherit;font-size:12px;color:#f0f1f6;background:#2c2b35;border:1px solid #545064;border-radius:7px;padding:7px 10px}.aureon-presentation-modes button[aria-pressed=true]{background:#47316d;border-color:#9c7bd8}.aureon-presentation-modes button:hover:not(:disabled){background:#47316d}.aureon-presentation-modes button:disabled{opacity:.5;cursor:default}.aureon-presentation-choice{display:flex;align-items:center;gap:8px;margin:0 0 0 auto;min-width:0;font-size:12px;color:#c5bfd5}.aureon-presentation-choice select{max-width:300px;min-width:0}.aureon-presentation-choice select:focus-visible{outline:2px solid #bfa5ff;outline-offset:2px}
.aureon-presenter-layout{display:grid;grid-template-columns:minmax(0,1fr) 220px}.aureon-presentation-participants{min-height:0;min-width:0;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:12px;background:#202129}.aureon-presentation-gallery{flex:1;min-width:0;min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));grid-auto-rows:minmax(240px,1fr);gap:14px;padding:16px}.aureon-presentation-gallery>.aureon-media-card{min-height:0}.aureon-presentation-gallery>.aureon-media-card video{flex:1;min-height:0;height:0;aspect-ratio:auto}.aureon-presentation-gallery>.aureon-media-card .aureon-media-avatar{flex:1;min-height:0;aspect-ratio:auto}.aureon-media-caption{flex-shrink:0}
.aureon-media-card{position:relative;display:flex;flex-direction:column;flex-shrink:0;min-width:0;overflow:hidden;border:1px solid #45434f;border-radius:10px;background:#292a32;color:#f0f1f6;font:inherit;padding:0;text-align:left}.aureon-media-card video{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#08090c;image-rendering:auto!important}.aureon-media-avatar{display:flex;align-items:center;justify-content:center;aspect-ratio:16/9;background:#26252e;color:#e4dbfa;overflow:hidden}.aureon-media-avatar img{display:block;max-width:85%;height:85%;object-fit:contain;image-rendering:auto}.aureon-media-avatar span{display:flex;align-items:center;justify-content:center;width:58px;height:58px;border-radius:50%;background:#4c3c68;font-size:22px;font-weight:600}.aureon-media-caption{padding:9px 11px;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.aureon-media-screen{cursor:pointer}.aureon-media-screen:hover{border-color:#bfa5ff}.aureon-presentation [hidden]{display:none!important}
.aureon-call-view-trigger{font:inherit;font-size:12px;line-height:1.3;padding:7px 10px;color:#f0f1f6;background:#342b49;border:1px solid #545064;border-radius:8px;cursor:pointer}.aureon-call-view-trigger:hover{background:#47316d}.aureon-call-view-trigger:focus-visible{outline:2px solid #bfa5ff;outline-offset:2px}.call-dock>.aureon-call-view-trigger{width:28px;height:28px;min-width:28px;padding:0;font-size:20px;line-height:1}
.aureon-presentation-status{flex-shrink:0;margin:0;padding:0 16px;color:#c5bfd5;font-size:12px;line-height:1.5}.aureon-presentation-status:not(:empty){padding:9px 16px}
.aureon-presentation-content:fullscreen{width:100vw;height:100dvh;max-width:none;max-height:none;border:0;border-radius:0}
@media(max-width:600px){.aureon-screen-preview .aureon-screen-actions{flex-wrap:wrap}.aureon-screen-actions{gap:5px}.aureon-screen-actions span{font-size:10px}.aureon-screen-actions button{font-size:10px}dialog.aureon-presentation{width:calc(100vw - 12px);height:calc(100dvh - 12px);max-height:calc(100dvh - 12px);border-radius:10px}.aureon-presentation-bar{align-items:flex-start;gap:8px;padding:10px;flex-direction:column}.aureon-presentation-bar h2{max-width:100%;font-size:13px}.aureon-presentation-controls{width:100%;justify-content:flex-end}.aureon-presentation-controls button{padding:7px 10px}.aureon-presentation-modes{padding:8px 10px}.aureon-presentation-choice{width:100%;margin:0}.aureon-presentation-choice select{flex:1;max-width:100%}.aureon-presenter-layout{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) 132px}.aureon-presentation-participants{flex-direction:row;padding:8px;gap:8px}.aureon-presentation-participants .aureon-media-card{width:150px}.aureon-presentation-participants .aureon-media-caption{padding:5px 8px;font-size:11px}.aureon-presentation-gallery{grid-template-columns:minmax(0,1fr);grid-auto-rows:minmax(210px,1fr);gap:10px;padding:10px}}
`;
    document.head.append(style);
    createDialog();
    observer = new window.MutationObserver(changes => { if (relevant(changes)) schedule(); });
    observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'class', 'src']});
    if (typeof window.ResizeObserver === 'function') resizeObserver = new window.ResizeObserver(schedule);
    listen(window, 'resize', () => { finishGesture(); schedule(); });
    listen(window, 'pointermove', moveGesture);
    listen(window, 'pointerup', event => {
      if (gesture?.pointerId === event.pointerId) { event.preventDefault(); event.stopPropagation(); finishGesture(); }
    });
    listen(window, 'pointercancel', event => {
      if (gesture?.pointerId === event.pointerId) { event.preventDefault(); event.stopPropagation(); finishGesture(true); }
    });
    listen(window, 'blur', () => finishGesture(true));
    listen(window, 'aureon-interface-state', schedule);
    listen(window, 'aureon-office-session-ended', close);
    listen(window, 'pagehide', close);
    if (typeof mediaSources?.subscribe === 'function') {
      try { unsubscribeSources = mediaSources.subscribe(schedule); } catch { /* The snapshot still fails closed when the provider is unavailable. */ }
    }
    refresh();
  }
  function destroy() {
    if (destroyed) return;
    close();
    destroyed = true;
    observer?.disconnect();
    resizeObserver?.disconnect();
    watchedLayout.clear();
    try { if (typeof unsubscribeSources === 'function') unsubscribeSources(); } catch {}
    unsubscribeSources = null;
    watchSources(null);
    callLauncher?.remove();
    listeners.splice(0).forEach(remove => remove());
    for (const record of records.values()) detach(record);
    dialog?.remove();
    style?.remove();
    started = false;
  }
  return {prepareInput, start, close, destroy, openCall};
}
