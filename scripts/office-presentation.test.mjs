import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createOfficePresentation} from './office-presentation.mjs';

// The DOM/media fixture has no device, network or browser permission APIs.
// Its tracks throw if a presentation-only control tries to stop capture.
function fixture(mediaSources) {
  class Events {
    listeners = new Map();
    addEventListener(type, callback) { const set = this.listeners.get(type) || new Set(); set.add(callback); this.listeners.set(type, set); }
    removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
    dispatch(type, event = {}) {
      const dispatched = {type, currentTarget: this, target: this, preventDefault() { event.prevented = true; },
        stopPropagation() { event.stopped = true; }, stopImmediatePropagation() { event.stopped = true; event.immediateStopped = true; }, ...event};
      const results = [];
      for (const callback of this.listeners.get(type) || []) { results.push(callback(dispatched)); if (event.immediateStopped) break; }
      return Promise.all(results);
    }
  }
  const document = new Events();
  class Element extends Events {
    constructor(tag) {
      super(); this.tagName = tag.toUpperCase(); this.nodeType = 1; this.namespaceURI = 'http://www.w3.org/1999/xhtml';
      this.children = []; this.parentNode = null; this.attributes = new Map(); this.className = ''; this.id = ''; this.hidden = false;
      this.style = {}; this.dataset = {}; this._text = ''; this.srcObject = null; this.currentSrc = ''; this.ended = false; this.open = false;
      this.playCount = 0; this.pauseCount = 0; this.loadCount = 0; this.showCount = 0; this.captures = new Set(); this.rect = null;
    }
    get parentElement() { return this.parentNode instanceof Element ? this.parentNode : null; }
    get isConnected() { return this.parentNode === document || this.parentNode?.isConnected === true; }
    get classList() { return {contains: name => this.className.split(/\s+/).includes(name),
      add: name => { if (!this.className.split(/\s+/).includes(name)) this.className += ' ' + name; },
      remove: name => { this.className = this.className.split(/\s+/).filter(value => value !== name).join(' '); }}; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(text) { this._text = text; for (const child of this.children) child.parentNode = null; this.children = []; }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
    insertBefore(node, before) { node.remove(); const index = this.children.indexOf(before); if (index < 0) throw Error('Missing insertion target'); node.parentNode = this; this.children.splice(index, 0, node); }
    remove() { if (this.parentNode?.children) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    matches(selector) {
      return selector.split(',').some(part => {
        const value = part.trim();
        if (value.includes(' ')) { const [ancestor, leaf] = value.split(/\s+/); return this.matches(leaf) && !!this.parentElement?.closest(ancestor); }
        if (value === '[hidden]') return this.hidden;
        if (value[0] === '#') return this.id === value.slice(1);
        if (value[0] === '.') return this.classList.contains(value.slice(1));
        return this.tagName === value.toUpperCase();
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) { const results = []; for (const child of this.children) { if (child.matches(selector)) results.push(child); results.push(...child.querySelectorAll(selector)); } return results; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    focus() { document.activeElement = this; }
    play() { this.playCount++; return Promise.resolve(); }
    pause() { this.pauseCount++; }
    load() { this.loadCount++; }
    showModal() { this.open = true; this.showCount++; }
    close() { this.open = false; void this.dispatch('close'); }
    requestFullscreen() { if (this.tagName === 'DIALOG') return Promise.reject(Error('Dialog is not fullscreen eligible')); document.fullscreenElement = this; void document.dispatch('fullscreenchange'); return Promise.resolve(); }
    getBoundingClientRect() {
      if (this.rect) return {...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height};
      const left = parseFloat(this.style.left) || 0, top = parseFloat(this.style.top) || 0;
      const width = parseFloat(this.style.width) || 0, height = parseFloat(this.style.height) || 0;
      return {left, top, width, height, right: left + width, bottom: top + height};
    }
    setPointerCapture(id) { this.captures.add(id); }
    hasPointerCapture(id) { return this.captures.has(id); }
    releasePointerCapture(id) { this.captures.delete(id); }
  }
  document.createElement = tag => new Element(tag);
  document.head = new Element('head'); document.head.parentNode = document;
  document.body = new Element('body'); document.body.parentNode = document;
  document.getElementById = id => [document.head, document.body].flatMap(root => root.querySelectorAll('#' + id))[0] || null;
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  document.querySelector = selector => document.querySelectorAll(selector)[0] || null;
  document.fullscreenElement = null; document.exitCalls = 0;
  document.exitFullscreen = () => { document.exitCalls++; document.fullscreenElement = null; void document.dispatch('fullscreenchange'); return Promise.resolve(); };
  const microtasks = [], observers = [], sizeObservers = [];
  const window = new Events();
  window.innerWidth = 1200; window.innerHeight = 800;
  window.queueMicrotask = callback => microtasks.push(callback);
  window.getComputedStyle = node => ({display: node.style.display || 'block', visibility: node.style.visibility || 'visible'});
  window.MutationObserver = class {
    constructor(callback) { this.callback = callback; this.active = false; observers.push(this); }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
  };
  window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); sizeObservers.push(this); }
    observe(node) { this.targets.add(node); }
    unobserve(node) { this.targets.delete(node); }
    disconnect() { this.targets.clear(); }
  };
  let captureCalls = 0;
  window.navigator = {mediaDevices: {getUserMedia() { captureCalls++; throw Error('No devices permitted'); }, getDisplayMedia() { captureCalls++; throw Error('No devices permitted'); }}};
  function stream() {
    const track = new Events(); track.readyState = 'live'; track.stopCalls = 0;
    track.stop = () => { track.stopCalls++; throw Error('Presentation must not stop capture'); };
    const media = new Events(); media.getVideoTracks = () => [track]; media.getTracks = () => [track];
    return {media, track};
  }
  function video(id = '', parent = document.body) { const node = new Element('video'); node.id = id; node.videoWidth = 1280; node.videoHeight = 960; const media = stream(); node.srcObject = media.media; parent.append(node); return {node, ...media}; }
  function layout(className, left, top, width, height) { const node = new Element('div'); node.className = className; node.rect = {left, top, width, height}; document.body.append(node); return node; }
  function flush() { let count = 0; while (microtasks.length) { if (++count > 100) throw Error('Observer/microtask loop'); microtasks.shift()(); } }
  function mutate(target, options = {}) { for (const observer of observers) if (observer.active) observer.callback([{target, type: options.type || 'childList', addedNodes: options.addedNodes || [], removedNodes: options.removedNodes || [], ...options}]); flush(); }
  function button(label, root = document.body) { const found = root.querySelectorAll('button').find(node => node.textContent === label); assert.ok(found, 'Missing button: ' + label); return found; }
  const serialized = new vm.Script('(' + createOfficePresentation.toString() + ')').runInNewContext({}, {timeout: 1000});
  const presentation = serialized({window, document, mediaSources});
  return {document, window, observers, sizeObservers, presentation, video, stream, layout, mutate, flush, button, get captureCalls() { return captureCalls; }};
}

test('factory is serializable and lazy; starting twice keeps the original preview/stream and one set of controls', () => {
  const h = fixture(); assert.equal(h.document.body.children.length, 0); assert.equal(h.observers.length, 0);
  const local = h.video('screenPreview');
  h.presentation.start(); h.presentation.start();
  assert.equal(h.document.getElementById('screenPreview'), local.node);
  assert.equal(local.node.srcObject, local.media);
  assert.equal(h.document.body.querySelectorAll('.aureon-screen-preview').length, 1);
  assert.equal(h.document.body.querySelectorAll('dialog').length, 1);
  assert.equal(h.observers.length, 1); assert.equal(h.captureCalls, 0); assert.equal(local.track.stopCalls, 0);
});

test('amplify, fullscreen and minimize reuse one stream, return focus and leave capture alive', async () => {
  const h = fixture(), local = h.video('screenPreview'); h.presentation.start();
  const amplify = h.button('Ampliar compartilhamento'); await amplify.dispatch('click');
  const dialog = h.document.body.querySelector('dialog'), viewer = dialog.querySelector('video');
  assert.equal(dialog.open, true); assert.equal(viewer.srcObject, local.media); assert.equal(viewer.muted, true);
  assert.equal(h.document.activeElement, h.button('Minimizar'));
  await h.button('Tela cheia').dispatch('click'); assert.equal(h.document.fullscreenElement, dialog.querySelector('section'));
  await h.button('Minimizar').dispatch('click');
  assert.equal(dialog.open, false); assert.equal(viewer.srcObject, null); assert.equal(h.document.fullscreenElement, null);
  assert.equal(h.document.exitCalls, 1); assert.equal(h.document.activeElement, amplify);
  assert.equal(local.node.srcObject, local.media); assert.equal(local.track.stopCalls, 0); assert.equal(h.captureCalls, 0);
});

test('Escape/native cancel minimizes; fullscreen rejection preserves the large window with accessible feedback', async () => {
  const h = fixture(); h.video('screenPreview'); h.presentation.start();
  await h.button('Ampliar compartilhamento').dispatch('click');
  const dialog = h.document.body.querySelector('dialog');
  dialog.querySelector('section').requestFullscreen = async () => { throw Error('User policy rejected fullscreen'); };
  await h.button('Tela cheia').dispatch('click');
  assert.equal(dialog.open, true); assert.match(dialog.querySelector('p').textContent, /janela ampliada/);
  const cancel = {}; await dialog.dispatch('cancel', cancel);
  assert.equal(cancel.prevented, true); assert.equal(dialog.open, false); assert.equal(dialog.querySelector('video').srcObject, null);
});

test('a fullscreen request resolving after minimize cannot reopen a stale presentation', async () => {
  const h = fixture(), local = h.video('screenPreview'); h.presentation.start(); await h.button('Ampliar compartilhamento').dispatch('click');
  const dialog = h.document.body.querySelector('dialog'), surface = dialog.querySelector('section');
  let complete;
  surface.requestFullscreen = () => new Promise(resolve => { complete = () => { h.document.fullscreenElement = surface; resolve(); }; });
  const request = h.button('Tela cheia').dispatch('click');
  h.presentation.close(); complete(); await request;
  assert.equal(h.document.fullscreenElement, null); assert.equal(dialog.open, false);
  assert.equal(dialog.querySelector('video').srcObject, null); assert.equal(local.node.srcObject, local.media);
  assert.equal(local.track.stopCalls, 0);
});

test('hidden, emptied, ended and session-ended sources close the duplicate without stopping its source', async () => {
  for (const cause of ['hidden', 'emptied', 'ended', 'session-ended']) {
    const h = fixture(), local = h.video('screenPreview'); h.presentation.start();
    await h.button('Ampliar compartilhamento').dispatch('click');
    if (cause === 'hidden') { local.node.hidden = true; h.mutate(local.node, {type: 'attributes', attributeName: 'hidden'}); }
    else if (cause === 'session-ended') await h.window.dispatch('aureon-office-session-ended');
    else { if (cause === 'ended') local.track.readyState = 'ended'; await local.node.dispatch(cause); h.flush(); }
    const dialog = h.document.body.querySelector('dialog');
    assert.equal(dialog.open, false, cause); assert.equal(dialog.querySelector('video').srcObject, null, cause);
    assert.equal(local.node.srcObject, local.media); assert.equal(local.track.stopCalls, 0); assert.equal(h.captureCalls, 0);
  }
});

test('track termination closes promptly, and an initially hidden preview can become available again', async () => {
  const h = fixture(), local = h.video('screenPreview'); local.node.hidden = true; h.presentation.start();
  const wrapper = local.node.parentElement; assert.equal(wrapper.hidden, true);
  local.node.hidden = false; h.mutate(local.node, {type: 'attributes', attributeName: 'hidden'});
  assert.equal(wrapper.hidden, false); await h.button('Ampliar compartilhamento').dispatch('click');
  local.track.readyState = 'ended'; await local.track.dispatch('ended'); h.flush();
  assert.equal(h.document.body.querySelector('dialog').open, false); assert.equal(wrapper.hidden, true);
});

test('remote tiles added after startup gain controls and removal clears their viewer and listeners', async () => {
  const h = fixture(); h.presentation.start();
  const tile = h.document.createElement('div'); tile.className = 'r-screen-tile';
  const title = h.document.createElement('small'); title.textContent = 'Tela de Felipe'; tile.append(title);
  const remote = h.video('', tile); h.document.body.append(tile);
  h.mutate(h.document.body, {addedNodes: [tile]});
  assert.equal(tile.querySelectorAll('button').length, 1);
  await h.button('Ampliar compartilhamento', tile).dispatch('click');
  const dialog = h.document.body.querySelector('dialog'); assert.equal(dialog.querySelector('h2').textContent, 'Tela de Felipe');
  assert.equal(dialog.querySelector('video').srcObject, remote.media);
  tile.remove(); h.mutate(h.document.body, {removedNodes: [tile]});
  assert.equal(dialog.open, false); assert.equal(dialog.querySelector('video').srcObject, null);
  assert.equal(remote.track.listeners.get('ended').size, 0); assert.equal(remote.track.stopCalls, 0);
});

test('source replacement follows loaded metadata; SVG mutations do not trigger presentation rescans', async () => {
  const h = fixture(), local = h.video('screenPreview'); h.presentation.start(); await h.button('Ampliar compartilhamento').dispatch('click');
  const replacement = h.video('', h.document.createElement('div'));
  local.node.srcObject = replacement.media; await local.node.dispatch('loadedmetadata'); h.flush();
  assert.equal(h.document.body.querySelector('dialog').querySelector('video').srcObject, replacement.media);
  let scans = 0; const query = h.document.querySelectorAll; h.document.querySelectorAll = (...args) => { scans++; return query(...args); };
  const svg = h.document.createElement('svg'); svg.namespaceURI = 'http://www.w3.org/2000/svg'; h.document.body.append(svg);
  h.mutate(svg, {type: 'attributes', attributeName: 'class'}); assert.equal(scans, 0);
  assert.equal(local.track.listeners.get('ended').size, 0); assert.equal(replacement.track.listeners.get('ended').size, 1);
});

test('destroy restores the same preview element, closes fullscreen, removes listeners and makes queued work inert', async () => {
  const h = fixture(), local = h.video('screenPreview'); h.presentation.start(); await h.button('Ampliar compartilhamento').dispatch('click'); await h.button('Tela cheia').dispatch('click');
  await h.window.dispatch('aureon-interface-state'); h.presentation.destroy(); h.presentation.destroy(); h.flush(); h.presentation.start();
  assert.equal(local.node.parentNode, h.document.body); assert.equal(local.node.srcObject, local.media);
  assert.equal(h.document.body.querySelectorAll('dialog').length, 0); assert.equal(h.document.head.children.length, 0);
  assert.equal(h.document.body.querySelectorAll('button').length, 0); assert.equal(h.observers[0].active, false);
  assert.equal(local.track.listeners.get('ended').size, 0); assert.equal(local.node.listeners.get('loadedmetadata').size, 0);
  assert.equal(h.window.listeners.get('aureon-office-session-ended').size, 0); assert.equal(local.track.stopCalls, 0); assert.equal(h.captureCalls, 0);
});

test('a file video fixture can be enlarged without constructing a MediaStream', async () => {
  const h = fixture(), local = h.video('screenPreview'); local.node.srcObject = null; local.node.currentSrc = '/fixture-screen.webm';
  h.presentation.start(); await h.button('Ampliar compartilhamento').dispatch('click');
  const viewer = h.document.body.querySelector('dialog').querySelector('video');
  assert.equal(viewer.srcObject, null); assert.equal(viewer.getAttribute('src'), '/fixture-screen.webm');
  h.presentation.close(); assert.equal(viewer.getAttribute('src'), null); assert.equal(local.node.currentSrc, '/fixture-screen.webm');
});

function officeFixture() {
  const h = fixture();
  h.map = h.layout('map-viewport', 280, 40, 900, 740);
  h.sidebar = h.layout('sidebar', 0, 0, 270, 800);
  h.nav = h.layout('office-map-nav', 1120, 500, 48, 220);
  h.dock = h.layout('call-dock', 550, 724, 480, 48);
  h.local = h.video('screenPreview');
  h.presentation.start();
  h.wrapper = h.local.node.parentElement;
  return h;
}
function expectClear(h) {
  const rect = h.wrapper.getBoundingClientRect(), bounds = h.map.getBoundingClientRect();
  assert.ok(rect.left >= bounds.left && rect.top >= bounds.top, 'Preview stays inside map at top/left');
  assert.ok(rect.right <= bounds.right && rect.bottom <= bounds.bottom, 'Preview stays inside map at bottom/right');
  for (const node of [h.nav, h.dock, h.sidebar]) {
    const obstacle = node.getBoundingClientRect();
    assert.ok(rect.right <= obstacle.left - 11.9 || rect.left >= obstacle.right + 11.9 || rect.bottom <= obstacle.top - 11.9 || rect.top >= obstacle.bottom + 11.9,
      'Preview leaves space around ' + node.className);
  }
  assert.equal(h.local.node.srcObject, h.local.media); assert.equal(h.local.track.stopCalls, 0); assert.equal(h.captureCalls, 0);
  return rect;
}
async function pointerStart(h, target, extra = {}) {
  const event = {pointerId: 7, clientX: 400, clientY: 200, button: 0, isPrimary: true, target, ...extra};
  await (target.classList.contains('aureon-screen-resize') ? target : h.wrapper).dispatch('pointerdown', event);
  return event;
}

test('default preview sits left of map controls and above the dock, excluding the sidebar', () => {
  const h = officeFixture(), rect = expectClear(h);
  assert.ok(rect.right <= h.nav.rect.left - 12); assert.equal(rect.width, 320);
  assert.equal(h.wrapper.querySelectorAll('.aureon-screen-resize').length, 8);
  assert.ok(h.sizeObservers[0].targets.has(h.map)); assert.ok(h.sizeObservers[0].targets.has(h.nav));
});

test('dragging the video captures its pointer, clamps to the map and cannot cover either menu', async () => {
  const h = officeFixture(), down = await pointerStart(h, h.local.node);
  assert.equal(down.prevented, true); assert.equal(down.stopped, true); assert.equal(h.wrapper.hasPointerCapture(7), true);
  await h.window.dispatch('pointermove', {pointerId: 7, clientX: -10000, clientY: -10000});
  let rect = expectClear(h); assert.equal(rect.left, h.map.rect.left + 12); assert.equal(rect.top, h.map.rect.top + 12);
  await h.window.dispatch('pointermove', {pointerId: 7, clientX: 10000, clientY: 10000});
  rect = expectClear(h); assert.ok(rect.right <= h.map.rect.left + h.map.rect.width);
  await h.window.dispatch('pointerup', {pointerId: 7}); assert.equal(h.wrapper.hasPointerCapture(7), false);
});

test('resize edges and corners change dimensions while preserving clear regions and live media', async () => {
  for (const edge of ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw']) {
    const h = officeFixture(), handle = h.wrapper.querySelector('.aureon-screen-resize-' + edge);
    const before = h.wrapper.getBoundingClientRect();
    await pointerStart(h, handle);
    await h.window.dispatch('pointermove', {pointerId: 7, clientX: edge.includes('w') ? -3000 : 5000, clientY: edge.includes('n') ? -3000 : 5000});
    const after = expectClear(h);
    assert.ok(after.width >= 240 && after.height >= 144, edge + ' retains useful minimum size');
    assert.ok(after.width !== before.width || after.height !== before.height, edge + ' resizes');
    await h.window.dispatch('pointerup', {pointerId: 7}); assert.equal(handle.hasPointerCapture(7), false);
  }
});

test('touch pointer cancel restores the starting card and unrelated pointers cannot move it', async () => {
  const h = officeFixture(), before = expectClear(h);
  await pointerStart(h, h.local.node, {pointerType: 'touch'});
  await h.window.dispatch('pointermove', {pointerId: 99, clientX: 0, clientY: 0});
  assert.deepEqual(h.wrapper.getBoundingClientRect(), before);
  await h.window.dispatch('pointermove', {pointerId: 7, clientX: 0, clientY: 0});
  assert.notDeepEqual(h.wrapper.getBoundingClientRect(), before);
  await h.window.dispatch('pointercancel', {pointerId: 7});
  assert.deepEqual(h.wrapper.getBoundingClientRect(), before); assert.equal(h.wrapper.hasPointerCapture(7), false); expectClear(h);
});

test('amplify button does not start dragging; minimize keeps the moved position and size', async () => {
  const h = officeFixture(), amplify = h.button('Ampliar compartilhamento');
  const down = await pointerStart(h, amplify); assert.equal(down.prevented, undefined); assert.equal(h.wrapper.hasPointerCapture(7), false);
  await pointerStart(h, h.local.node);
  await h.window.dispatch('pointermove', {pointerId: 7, clientX: 20, clientY: 80}); await h.window.dispatch('pointerup', {pointerId: 7});
  const position = expectClear(h);
  await amplify.dispatch('click'); await h.button('Minimizar').dispatch('click');
  assert.deepEqual(h.wrapper.getBoundingClientRect(), position); expectClear(h);
});

test('window and observed map resizing re-fit the preview without clipping or covering controls on a narrow display', async () => {
  const h = officeFixture(); await pointerStart(h, h.local.node);
  await h.window.dispatch('pointermove', {pointerId: 7, clientX: 200, clientY: 100}); await h.window.dispatch('pointerup', {pointerId: 7});
  h.window.innerWidth = 420; h.window.innerHeight = 500;
  h.map.rect = {left: 100, top: 20, width: 310, height: 470}; h.sidebar.rect = {left: 0, top: 0, width: 90, height: 500};
  h.nav.rect = {left: 350, top: 280, width: 48, height: 140}; h.dock.rect = {left: 130, top: 438, width: 205, height: 40};
  await h.window.dispatch('resize'); h.flush(); let rect = expectClear(h);
  assert.ok(rect.width < 320); assert.ok(rect.width > 0 && rect.height > 0);
  h.nav.rect = {left: 350, top: 180, width: 48, height: 240}; h.sizeObservers[0].callback(); h.flush(); rect = expectClear(h);
  assert.ok(rect.width < 240, 'Minimum adapts to the actual free width on a narrow map');
  h.presentation.destroy(); assert.equal(h.sizeObservers[0].targets.size, 0);
});

test('early keyboard preparation prevents the legacy capture listener from moving the avatar', async () => {
  const h = fixture(); h.presentation.prepareInput(); h.presentation.prepareInput();
  let avatarMoves = 0; h.window.addEventListener('keydown', () => { avatarMoves++; }, true);
  h.local = h.video('screenPreview'); h.presentation.start(); h.wrapper = h.local.node.parentElement;
  const bar = h.wrapper.querySelector('.aureon-screen-actions'), before = h.wrapper.getBoundingClientRect();
  const arrow = {target: bar, key: 'ArrowLeft'}; await h.window.dispatch('keydown', arrow);
  assert.equal(avatarMoves, 0); assert.equal(arrow.prevented, true); assert.equal(arrow.immediateStopped, true);
  assert.equal(h.wrapper.getBoundingClientRect().left, before.left - 10);
  const handle = h.wrapper.querySelector('.aureon-screen-resize-w'), width = h.wrapper.getBoundingClientRect().width;
  await h.window.dispatch('keydown', {target: handle, key: 'ArrowLeft', shiftKey: true});
  assert.equal(h.wrapper.getBoundingClientRect().width, width + 40); assert.equal(avatarMoves, 0);
  const position = h.wrapper.getBoundingClientRect();
  await h.window.dispatch('keydown', {target: h.button('Ampliar compartilhamento'), key: 'ArrowRight'});
  assert.deepEqual(h.wrapper.getBoundingClientRect(), position); assert.equal(avatarMoves, 0);
  await h.window.dispatch('keydown', {target: h.document.body, key: 'ArrowRight'}); assert.equal(avatarMoves, 1);
});

function callFixture({screens = true, tools = true} = {}) {
  let value, reads = 0, subscriptions = 0, unsubscriptions = 0;
  const callbacks = new Set();
  const provider = {
    getSnapshot() { reads++; return value; },
    subscribe(callback) { subscriptions++; callbacks.add(callback); return () => { unsubscriptions++; callbacks.delete(callback); }; },
  };
  const h = fixture(provider);
  const people = [{id: 'allan', name: 'Allan Giro', isSelf: true}, {id: 'felipe', name: 'Felipe Queiroz', isSelf: false},
    {id: 'ana', name: 'Ana Lima', isSelf: false, avatarUrl: '/avatar-ana.png'}];
  const camera = h.stream(), first = h.stream(), second = h.stream();
  value = {revision: 1, sessionId: 'meeting-a', participants: people, sources: [
    {id: 'meeting-a:allan:camera', kind: 'camera', participantId: 'allan', label: 'Allan Giro', isSelf: true, stream: camera.media},
    ...(screens ? [
      {id: 'meeting-a:allan:screen', kind: 'screen', participantId: 'allan', label: 'Tela de Allan', isSelf: true, stream: first.media},
      {id: 'meeting-a:felipe:screen', kind: 'screen', participantId: 'felipe', label: 'Tela de Felipe', isSelf: false, stream: second.media},
    ] : []),
  ]};
  const host = tools ? h.layout('r-call-tools', 20, 40, 600, 40) : null;
  const set = next => { value = typeof next === 'function' ? next(value) : next; for (const callback of callbacks) callback(); h.flush(); };
  return Object.assign(h, {host, people, camera, first, second, provider, set, getSnapshot: () => value,
    stats: () => ({reads, subscriptions, unsubscriptions, listeners: callbacks.size})});
}

function presentationParts(h) {
  const dialog = h.document.body.querySelector('dialog');
  return {dialog, viewer: dialog.querySelector('.aureon-presentation-video'), select: dialog.querySelector('select'),
    grid: dialog.querySelector('.aureon-presentation-gallery'), rail: dialog.querySelector('.aureon-presentation-participants')};
}

function assertCaptureAlive(h) {
  for (const media of [h.camera, h.first, h.second]) assert.equal(media.track.stopCalls, 0);
  assert.equal(h.captureCalls, 0);
  assert.equal(h.document.querySelectorAll('audio').length, 0, 'Presentation creates no audio element');
  for (const video of h.document.querySelectorAll('dialog video')) assert.equal(video.muted, true, 'Every duplicate is muted');
}

test('optional media provider is lazy, idempotent and unsubscribed with every owned stream listener on destroy', async () => {
  const h = callFixture(); assert.deepEqual(h.stats(), {reads: 0, subscriptions: 0, unsubscriptions: 0, listeners: 0});
  assert.equal(h.presentation.openCall(), false); assert.equal(h.stats().reads, 0);
  h.presentation.start(); h.presentation.start();
  assert.equal(h.stats().subscriptions, 1); assert.equal(h.host.querySelectorAll('.aureon-call-view-trigger').length, 1);
  await h.button('Visualizar chamada').dispatch('click');
  const copies = h.document.querySelectorAll('dialog video');
  assert.ok(copies.some(node => node.srcObject === h.first.media));
  h.presentation.destroy(); h.presentation.destroy();
  assert.equal(h.stats().unsubscriptions, 1); assert.equal(h.stats().listeners, 0);
  assert.equal(h.host.querySelectorAll('.aureon-call-view-trigger').length, 0);
  for (const media of [h.camera, h.first, h.second]) {
    for (const listeners of [...media.track.listeners.values(), ...media.media.listeners.values()]) assert.equal(listeners.size, 0);
  }
  for (const copy of copies) assert.equal(copy.srcObject, null);
  assertCaptureAlive(h);
});

test('presenter and gallery show authorized cameras, off-camera avatars and screens using the original streams', async () => {
  const h = callFixture(); h.presentation.start(); const launcher = h.button('Visualizar chamada'); await launcher.dispatch('click');
  const {dialog, viewer, select, grid, rail} = presentationParts(h);
  assert.equal(dialog.open, true); assert.equal(viewer.srcObject, h.first.media); assert.equal(rail.hidden, false);
  assert.equal(rail.querySelectorAll('.aureon-media-card').length, 3);
  assert.equal(rail.querySelector('video').srcObject, h.camera.media);
  assert.equal(rail.querySelectorAll('.aureon-media-avatar')[1].querySelector('span').textContent, 'FQ');
  assert.equal(rail.querySelectorAll('img')[2].getAttribute('src'), '/avatar-ana.png');
  assert.equal(select.getAttribute('aria-label'), 'Tela em destaque'); assert.equal(select.children.length, 2);
  await h.button('Galeria').dispatch('click');
  assert.equal(grid.hidden, false); assert.equal(rail.hidden, true); assert.equal(viewer.srcObject, null);
  assert.equal(grid.querySelectorAll('.aureon-media-card').length, 5);
  assert.equal(grid.querySelectorAll('.aureon-media-screen').length, 2);
  assert.equal(grid.querySelectorAll('video').filter(node => node.srcObject).length, 3);
  const screen = grid.querySelectorAll('.aureon-media-screen')[1];
  assert.equal(screen.getAttribute('aria-label'), 'Apresentar Tela de Felipe'); await screen.dispatch('click');
  assert.equal(viewer.srcObject, h.second.media); assert.equal(grid.hidden, true); assert.equal(select.value, 'meeting-a:felipe:screen');
  await h.button('Tela cheia').dispatch('click'); assert.equal(h.document.fullscreenElement, dialog.querySelector('section'));
  await h.button('Minimizar').dispatch('click');
  assert.equal(dialog.open, false); assert.equal(h.document.fullscreenElement, null); assert.equal(h.document.activeElement, launcher);
  assert.equal(viewer.srcObject, null); assert.equal(rail.children.length, 0); assert.equal(grid.children.length, 0);
  assertCaptureAlive(h);
});

test('screen selection survives new shares and minimize; an ended selected source falls back without stealing selection', async () => {
  const h = callFixture(); h.presentation.start(); await h.button('Visualizar chamada').dispatch('click');
  const {viewer, select, grid} = presentationParts(h);
  select.value = 'meeting-a:felipe:screen'; await select.dispatch('change'); assert.equal(viewer.srcObject, h.second.media);
  const third = h.stream();
  h.set(value => ({...value, revision: value.revision + 1, sources: [...value.sources,
    {id: 'meeting-a:ana:screen', kind: 'screen', participantId: 'ana', label: 'Tela de Ana', isSelf: false, stream: third.media}]}));
  assert.equal(viewer.srcObject, h.second.media); assert.equal(select.children.length, 3);
  await h.button('Minimizar').dispatch('click'); await h.button('Visualizar chamada').dispatch('click');
  assert.equal(viewer.srcObject, h.second.media);
  h.second.track.readyState = 'ended'; await h.second.track.dispatch('ended'); h.flush();
  assert.equal(viewer.srcObject, h.first.media); assert.equal(select.value, 'meeting-a:allan:screen');
  h.first.track.readyState = 'ended'; third.track.readyState = 'ended'; await third.track.dispatch('ended'); h.flush();
  assert.equal(viewer.srcObject, null); assert.equal(grid.hidden, false); assert.equal(h.button('Apresentador').disabled, true);
  assert.equal(select.children.length, 0); assert.equal(select.parentElement.hidden, true);
  assert.equal(third.track.stopCalls, 0); assertCaptureAlive(h);
});

test('camera mute/termination swaps to an avatar and replacement updates only the duplicate', async () => {
  const h = callFixture({screens: false}); h.presentation.start(); await h.button('Visualizar chamada').dispatch('click');
  const {grid, viewer} = presentationParts(h), firstCard = grid.querySelector('.aureon-media-card'), cameraCopy = firstCard.querySelector('video');
  assert.equal(grid.hidden, false); assert.equal(cameraCopy.srcObject, h.camera.media); assert.equal(viewer.srcObject, null);
  h.camera.track.muted = true; await h.camera.track.dispatch('mute'); h.flush();
  assert.equal(cameraCopy.srcObject, null); assert.equal(firstCard.querySelector('.aureon-media-avatar').hidden, false);
  h.camera.track.muted = false; await h.camera.track.dispatch('unmute'); h.flush(); assert.equal(cameraCopy.srcObject, h.camera.media);
  const next = h.stream();
  h.set(value => ({...value, revision: 2, sources: [{...value.sources[0], stream: next.media}]}));
  assert.equal(cameraCopy.srcObject, next.media); assert.equal(h.camera.track.listeners.get('ended').size, 0);
  next.track.readyState = 'ended'; await next.track.dispatch('ended'); h.flush(); assert.equal(cameraCopy.srcObject, null);
  assert.equal(next.track.stopCalls, 0); assertCaptureAlive(h);
});

test('revocation, malformed catalogs and a changed meeting close all duplicates and cannot reopen stale remote DOM', async () => {
  for (const cause of ['revoked', 'malformed', 'different-session', 'throwing-provider']) {
    const h = callFixture();
    const tile = h.document.createElement('div'); tile.className = 'r-screen-tile'; h.document.body.append(tile);
    const remote = h.video('', tile); remote.node.srcObject = h.second.media;
    h.presentation.start(); await h.button('Ampliar compartilhamento', tile).dispatch('click');
    const {dialog} = presentationParts(h), copies = dialog.querySelectorAll('video'); assert.equal(dialog.open, true, cause);
    if (cause === 'revoked') h.set({revision: 2, sessionId: null, participants: [], sources: []});
    else if (cause === 'malformed') h.set(value => ({...value, revision: 2, sources: [{...value.sources[0], id: 'spoofed-id'}]}));
    else if (cause === 'different-session') h.set({revision: 2, sessionId: 'meeting-b', participants: h.people, sources: []});
    else { h.provider.getSnapshot = () => { throw Error('Disconnected'); }; h.set(value => value); }
    assert.equal(dialog.open, false, cause); for (const video of copies) assert.equal(video.srcObject, null, cause);
    assert.equal(tile.querySelector('.aureon-screen-actions').hidden, true, cause);
    await h.button('Ampliar compartilhamento', tile).dispatch('click'); assert.equal(dialog.open, false, cause);
    assert.equal(remote.node.srcObject, h.second.media); assertCaptureAlive(h);
  }
});

test('a provider with no authorized meeting preserves only the local legacy preview', async () => {
  const h = callFixture(); h.set({revision: 1, sessionId: null, participants: [], sources: []});
  const local = h.video('screenPreview');
  const tile = h.document.createElement('div'); tile.className = 'r-screen-tile'; h.document.body.append(tile); const remote = h.video('', tile);
  h.presentation.start(); assert.equal(h.host.querySelectorAll('.aureon-call-view-trigger').length, 0);
  await h.button('Ampliar compartilhamento', tile).dispatch('click'); assert.equal(presentationParts(h).dialog.open, false);
  await h.button('Ampliar compartilhamento', local.node.parentElement).dispatch('click');
  const {dialog, viewer, grid, rail} = presentationParts(h);
  assert.equal(dialog.open, true); assert.equal(viewer.srcObject, local.media); assert.equal(grid.hidden, true); assert.equal(rail.hidden, true);
  assert.equal(h.presentation.openCall(), false); h.presentation.close();
  assert.equal(remote.node.srcObject, remote.media); assert.equal(local.node.srcObject, local.media);
  assert.equal(local.track.stopCalls, 0); assertCaptureAlive(h);
});

test('camera-only calls gain one dynamic launcher, move it to call tools and restore focus after native cancel', async () => {
  const h = callFixture({screens: false, tools: false}); h.presentation.start();
  assert.equal(h.document.querySelectorAll('.aureon-call-view-trigger').length, 0);
  const dock = h.layout('call-dock', 400, 700, 300, 50); h.mutate(h.document.body, {addedNodes: [dock]});
  const launcher = dock.querySelector('.aureon-call-view-trigger'); assert.equal(launcher.getAttribute('aria-label'), 'Visualizar chamada');
  assert.equal(launcher.textContent, '▦');
  const tools = h.layout('r-call-tools', 20, 40, 600, 40); h.mutate(h.document.body, {addedNodes: [tools]});
  assert.equal(tools.querySelector('.aureon-call-view-trigger'), launcher); assert.equal(launcher.textContent, 'Visualizar chamada');
  for (let i = 0; i < 4; i++) h.set(value => ({...value, revision: value.revision + 1}));
  assert.equal(h.document.querySelectorAll('.aureon-call-view-trigger').length, 1);
  await launcher.dispatch('click'); const {dialog, grid} = presentationParts(h); assert.equal(grid.children.length, 3);
  await dialog.dispatch('cancel'); assert.equal(dialog.open, false); assert.equal(h.document.activeElement, launcher);
  assert.equal(grid.children.length, 0); assertCaptureAlive(h);
});

test('local screen maps to its authorized source once, and a removed participant leaves no old camera or avatar', async () => {
  const h = callFixture(), local = h.video('screenPreview'); local.node.srcObject = h.first.media;
  h.presentation.start(); await h.button('Ampliar compartilhamento', local.node.parentElement).dispatch('click');
  await h.button('Galeria').dispatch('click'); const {dialog, grid} = presentationParts(h);
  assert.equal(grid.querySelectorAll('.aureon-media-screen').length, 2);
  const removedCard = grid.querySelectorAll('.aureon-media-card')[0], removedCamera = removedCard.querySelector('video');
  h.set(value => ({...value, revision: 2, participants: value.participants.filter(person => person.id !== 'allan'),
    sources: value.sources.filter(source => source.participantId !== 'allan')}));
  assert.equal(removedCard.isConnected, false); assert.equal(removedCamera.srcObject, null); assert.equal(dialog.open, true);
  assert.equal(grid.querySelectorAll('.aureon-media-card').length, 3);
  assert.equal(local.node.srcObject, h.first.media); assertCaptureAlive(h);
});

test('a hidden call toolbar yields to the map dock, without creating an invisible or duplicate entry', () => {
  const h = callFixture(), dock = h.layout('call-dock', 400, 700, 300, 50); h.host.style.display = 'none';
  h.presentation.start();
  const launcher = dock.querySelector('.aureon-call-view-trigger'); assert.ok(launcher);
  assert.equal(h.host.querySelectorAll('.aureon-call-view-trigger').length, 0);
  h.host.style.display = 'flex'; h.set(value => ({...value, revision: 2}));
  assert.equal(h.host.querySelector('.aureon-call-view-trigger'), launcher);
  assert.equal(h.document.querySelectorAll('.aureon-call-view-trigger').length, 1);
});

test('unchanged camera catalogs retain cards, playback and selector options; failed avatars retain a safe initials fallback', async () => {
  const h = callFixture(); h.presentation.start(); await h.button('Visualizar chamada').dispatch('click');
  const {select, rail} = presentationParts(h), camera = rail.querySelector('video'), cards = [...rail.children], options = [...select.children];
  const image = rail.querySelectorAll('img')[2]; await image.dispatch('error');
  h.set(value => ({...value, revision: 2}));
  assert.deepEqual(rail.children, cards); assert.deepEqual(select.children, options); assert.equal(camera.playCount, 1);
  assert.equal(image.hidden, true); assert.equal(image.parentElement.querySelector('span').hidden, false);
  assertCaptureAlive(h);
});
