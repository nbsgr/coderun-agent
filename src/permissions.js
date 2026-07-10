// permissions.js — Permission handling for dangerous tools

var pendingPermissions = {};

export function requestPermission(toolName, args, id, sendEvent) {
  return new Promise(function(resolve) {
    pendingPermissions[id] = resolve;
  });
}

export function resolvePermission(id, approved) {
  var resolver = pendingPermissions[id];
  if (resolver) {
    resolver(approved);
    delete pendingPermissions[id];
  }
}

export function cancelAllPermissions() {
  for (var id in pendingPermissions) {
    pendingPermissions[id](false);
  }
  pendingPermissions = {};
}