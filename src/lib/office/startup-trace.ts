// Temporary, bounded diagnosis of the first /escritorio document load.
// A native head script observes parser/streaming moves before React hydration.
// Only fixed enums and numbers leave the closure; no network or storage access.
export const OFFICE_STARTUP_TRACE_SCRIPT = String.raw`(function () {
  'use strict';
  if (window.location.pathname !== '/escritorio') return;
  var root = document.documentElement;
  var attribute = 'data-office-startup-trace';
  if (!root || root.hasAttribute(attribute)) return;
  var origin = window.location.origin;
  var runtimePath = '/api/office/runtime/index.html';
  var ids = new WeakMap();
  var frames = new Map();
  var nextId = 1;
  var timers = [];
  var observer = null;
  var resources = null;
  var stopped = false;
  var startedAt = clock();
  var trace = { version: 1, startedAt: startedAt, state: 'recording', stopReason: null, events: [] };

  function clock() {
    var value = window.performance.now();
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
  }
  function urlKind(value) {
    if (!value || value === 'about:blank') return 'blank';
    try {
      var parsed = new URL(value, origin);
      return parsed.origin === origin && parsed.pathname === runtimePath && !parsed.search && !parsed.hash ? 'runtime' : 'other';
    } catch (_) { return 'other'; }
  }
  function exact(frame) {
    return frame && frame.nodeType === 1 && frame.tagName === 'IFRAME' &&
      frame.getAttribute('title') === 'Escritório virtual Aureon' &&
      urlKind(frame.getAttribute('src')) === 'runtime';
  }
  function parentState(frame) {
    var parent = frame && frame.closest('[data-office-frame-phase]');
    if (!parent) parent = document.querySelector('[data-office-frame-phase]');
    var phase = parent && parent.getAttribute('data-office-frame-phase');
    var attempt = parent && parent.getAttribute('data-office-frame-attempt');
    return {
      phase: ['opening', 'ready', 'unavailable', 'expired'].indexOf(phase) >= 0 ? phase : 'unknown',
      attempt: typeof attempt === 'string' && /^(0|[1-9][0-9]{0,3})$/.test(attempt) ? Number(attempt) : null
    };
  }
  function snapshot(frame) {
    if (!ids.has(frame)) ids.set(frame, nextId++);
    var result = {
      node: ids.get(frame), connected: frame.isConnected === true,
      src: urlKind(frame.getAttribute('src')), document: 'unavailable',
      readyState: 'unknown', office: 'unknown', parent: parentState(frame)
    };
    try {
      var child = frame.contentDocument;
      if (child) {
        result.document = urlKind(child.URL);
        if (['loading', 'interactive', 'complete'].indexOf(child.readyState) >= 0) result.readyState = child.readyState;
        var office = child.documentElement && child.documentElement.getAttribute('data-office-crm');
        if (['loading', 'ready', 'unavailable', 'expired'].indexOf(office) >= 0) result.office = office;
      }
    } catch (_) { /* A cross-origin document remains an enum. */ }
    return result;
  }
  function publish() {
    try { root.setAttribute(attribute, JSON.stringify(trace)); } catch (_) { /* Diagnostic only. */ }
  }
  function stop(reason) {
    if (stopped) return;
    stopped = true;
    trace.state = 'stopped';
    trace.stopReason = reason;
    if (observer) observer.disconnect();
    if (resources) resources.disconnect();
    timers.forEach(function (timer) { window.clearTimeout(timer); });
    frames.forEach(function (handlers, frame) {
      frame.removeEventListener('load', handlers.load);
      frame.removeEventListener('error', handlers.error);
    });
    frames.clear();
    window.removeEventListener('message', message);
    window.removeEventListener('pagehide', pagehide);
    publish();
  }
  function record(kind, detail) {
    if (stopped) return;
    if (window.location.pathname !== '/escritorio') { stop('navigation'); return; }
    trace.events.push(Object.assign({ kind: kind, at: Math.max(0, clock() - startedAt) }, detail));
    if (trace.events.length >= 100) stop('limit');
    else publish();
  }
  function untrack(frame) {
    var handlers = frames.get(frame);
    if (!handlers) return;
    frame.removeEventListener('load', handlers.load);
    frame.removeEventListener('error', handlers.error);
    frames.delete(frame);
  }
  function track(frame, kind) {
    if (stopped || !exact(frame)) return;
    if (!frames.has(frame)) {
      var handlers = {
        load: function () { record('load', snapshot(frame)); },
        error: function () { record('error', snapshot(frame)); }
      };
      frames.set(frame, handlers);
      frame.addEventListener('load', handlers.load);
      frame.addEventListener('error', handlers.error);
    }
    record(kind, snapshot(frame));
  }
  function visit(node, callback) {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName === 'IFRAME') callback(node);
    if (node.querySelectorAll) node.querySelectorAll('iframe').forEach(callback);
  }
  function message(event) {
    if (event.origin !== origin || !event.data || typeof event.data !== 'object') return;
    var type = event.data.type;
    if (['aureon-office-ready', 'aureon-office-unavailable', 'aureon-office-session-ended'].indexOf(type) < 0) return;
    frames.forEach(function (_, frame) {
      if (exact(frame) && event.source === frame.contentWindow) record('message', Object.assign(snapshot(frame), { type: type }));
    });
  }
  function pagehide() { stop('pagehide'); }
  function number(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
  function resource(entry) {
    var parsed;
    try { parsed = new URL(entry.name, origin); } catch (_) { return; }
    if (parsed.origin !== origin || parsed.search || parsed.hash) return;
    var name = parsed.pathname === runtimePath ? 'runtime_index' : parsed.pathname === '/api/office/context' ? 'office_context' : null;
    if (!name) return;
    var timing = [];
    if (Array.isArray(entry.serverTiming)) entry.serverTiming.forEach(function (item) {
      if (timing.length < 3 && ['office_auth', 'office_asset', 'office_route'].indexOf(item.name) >= 0 && number(item.duration) !== null) {
        timing.push({ name: item.name, duration: item.duration });
      }
    });
    record('resource', {
      name: name, startTime: number(entry.startTime), duration: number(entry.duration),
      responseStart: number(entry.responseStart), requestStart: number(entry.requestStart),
      transferSize: number(entry.transferSize), serverTiming: timing, parent: parentState(null)
    });
  }
  try {
    observer = new MutationObserver(function (changes) {
      changes.forEach(function (change) {
        if (stopped) return;
        if (change.type === 'childList') {
          change.removedNodes.forEach(function (node) {
            visit(node, function (frame) {
              if (frames.has(frame)) { record('removed', snapshot(frame)); untrack(frame); }
            });
          });
          change.addedNodes.forEach(function (node) { visit(node, function (frame) { track(frame, 'added'); }); });
        } else if (change.attributeName === 'src' || change.attributeName === 'title') {
          var frame = change.target;
          if (frames.has(frame)) {
            record(change.attributeName === 'src' ? 'src' : 'title', snapshot(frame));
            if (!exact(frame)) untrack(frame);
          } else track(frame, 'added');
        } else {
          frames.forEach(function (_, frame) { record('parent', snapshot(frame)); });
        }
      });
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['src', 'title', 'data-office-frame-phase', 'data-office-frame-attempt'] });
    window.addEventListener('message', message);
    window.addEventListener('pagehide', pagehide);
    if (typeof PerformanceObserver === 'function') {
      try {
        resources = new PerformanceObserver(function (list) { list.getEntries().forEach(resource); });
        resources.observe({ type: 'resource', buffered: true });
      } catch (_) { if (resources) resources.disconnect(); resources = null; }
    }
    record('start', { parent: parentState(null) });
    document.querySelectorAll('iframe').forEach(function (frame) { track(frame, 'snapshot'); });
    if (stopped) return;
    [5000, 30000, 60000, 85000, 110000].forEach(function (delay) {
      timers.push(window.setTimeout(function () { frames.forEach(function (_, frame) { record('snapshot', snapshot(frame)); }); }, delay));
    });
    timers.push(window.setTimeout(function () { stop('timeout'); }, 120000));
  } catch (_) { stop('unsupported'); }
})();`;
