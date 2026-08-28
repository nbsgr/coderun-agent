// events.js — Simple event bus for loose coupling

var listeners = {};
var onceHandlers = [];

export function on(event, handler) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(handler);
  function unsubscribe() {
    off(event, handler);
  }
  return unsubscribe;
}

export function off(event, handler) {
  if (!listeners[event]) return;
  var idx = listeners[event].indexOf(handler);
  if (idx !== -1) listeners[event].splice(idx, 1);
}

export function emit(event, data) {
  if (!listeners[event]) return;
  var list = listeners[event];
  for (var i = 0; i < list.length; i++) {
    var fn = list[i];
    try {
      fn(data);
    } catch (e) {
      console.error('[EVENTS] Handler error:', e);
    }
  }
}

function handleOnce(index, data) {
  var entry = onceHandlers[index];
  if (!entry) return;
  off(entry.event, entry.wrapper);
  entry.handler(data);
  onceHandlers[index] = null;
}

export function once(event, handler) {
  var index = onceHandlers.length;
  function wrapper(data) {
    handleOnce(index, data);
  }
  var entry = {
    event: event,
    handler: handler,
    wrapper: wrapper
  };
  onceHandlers.push(entry);
  on(event, wrapper);
}

export function clear(event) {
  if (event) {
    delete listeners[event];
  } else {
    listeners = {};
  }
}