// events.js — Simple event bus for loose coupling

var listeners = {};

export function on(event, handler) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(handler);
  return function() {
    off(event, handler);
  };
}

export function off(event, handler) {
  if (!listeners[event]) return;
  var idx = listeners[event].indexOf(handler);
  if (idx !== -1) listeners[event].splice(idx, 1);
}

export function emit(event, data) {
  if (!listeners[event]) return;
  listeners[event].forEach(function(fn) {
    try { fn(data); } catch (e) { console.error('[EVENTS] Handler error:', e); }
  });
}

export function once(event, handler) {
  var wrapper = function(data) {
    off(event, wrapper);
    handler(data);
  };
  on(event, wrapper);
}

export function clear(event) {
  if (event) {
    delete listeners[event];
  } else {
    listeners = {};
  }
}