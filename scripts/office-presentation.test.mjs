import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createOfficePresentation} from './office-presentation.mjs';

// The DOM/media fixture has no device, network or browser permission APIs.
// Its tracks throw if a presentation-only control tries to stop capture.
function fixture() {
  class Events {
    listeners = new Map();
    addEventListener(type, callback) { const set = this.listeners.get(type) || new Set(); set.add(callback); this.listeners.set(type, set); }
    removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
    dispatch(type, event = {}) { return Promise.all([...this.listeners.get(type) || []].map(callback => callback({type, preventDefault() { event.prevented = true; }, ...event}))); }
  }
  const document = new Events();
  class Element extends Events {
    constructor(tag) {
      super(); this.tagName = tag.toUpperCase(); this.nodeType = 1; this.namespaceURI = 'http://www.w3.org/1999/xhtml';
      this.children = []; this.parentNode = null; this.attributes = new Map(); this.className = ''; this.id = ''; this.hidden = false;
      this.style = {}; this._text = ''; this.srcObject = null; this.currentSrc = ''; this.ended = false; this.open = false;
      this.playCount = 0; this.pauseCount = 0; this.loadCount = 0; this.showCount = 0;
    }
    get parentElement() { return this.parentNode instanceof Element ? this.parentNode : null; }
    get isConnected() { return this.parentNode === document || this.parentNode?.isConnected === true; }
    get classList() { return {contains: name => this.className.split(/\s+/).includes(name)}; }
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
  }
  document.createElement = tag => new Element(tag);
  document.head = new Element('head'); document.head.parentNode = document;
  document.body = new Element('body'); document.body.parentNode = document;
  document.getElementById = id => [document.head, document.body].flatMap(root => root.querySelectorAll('#' + id))[0] || null;
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  document.fullscreenElement = null; document.exitCalls = 0;
  document.exitFullscreen = () => { document.exitCalls++; document.fullscreenElement = null; void document.dispatch('fullscreenchange'); return Promise.resolve(); };
  const microtasks = [], observers = [];
  const window = new Events();
  window.queueMicrotask = callback => microtasks.push(callback);
  window.getComputedStyle = node => ({display: node.style.display || 'block', visibility: node.style.visibility || 'visible'});
  window.MutationObserver = class {
    constructor(callback) { this.callback = callback; this.active = false; observers.push(this); }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
  };
  let captureCalls = 0;
  window.navigator = {mediaDevices: {getUserMedia() { captureCalls++; throw Error('No devices permitted'); }, getDisplayMedia() { captureCalls++; throw Error('No devices permitted'); }}};
  function stream() {
    const track = new Events(); track.readyState = 'live'; track.stopCalls = 0;
    track.stop = () => { track.stopCalls++; throw Error('Presentation must not stop capture'); };
    const media = new Events(); media.getVideoTracks = () => [track]; media.getTracks = () => [track];
    return {media, track};
  }
  function video(id = '', parent = document.body) { const node = new Element('video'); node.id = id; const media = stream(); node.srcObject = media.media; parent.append(node); return {node, ...media}; }
  function flush() { let count = 0; while (microtasks.length) { if (++count > 100) throw Error('Observer/microtask loop'); microtasks.shift()(); } }
  function mutate(target, options = {}) { for (const observer of observers) if (observer.active) observer.callback([{target, type: options.type || 'childList', addedNodes: options.addedNodes || [], removedNodes: options.removedNodes || [], ...options}]); flush(); }
  function button(label, root = document.body) { const found = root.querySelectorAll('button').find(node => node.textContent === label); assert.ok(found, 'Missing button: ' + label); return found; }
  const serialized = new vm.Script('(' + createOfficePresentation.toString() + ')').runInNewContext({}, {timeout: 1000});
  const presentation = serialized({window, document});
  return {document, window, observers, presentation, video, mutate, flush, button, get captureCalls() { return captureCalls; }};
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
