// fileLockManager.js — Per-File & Hierarchical Path Mutation Queue
// Deterministic promise-chain queue serializing writes/edits to the same file or parent/child paths.

import path from 'path';

var _locks = {}; // { [normalizedPath]: Promise }

function normalizeLockKey(filePath) {
  if (!filePath) return '';
  return path.resolve(String(filePath)).toLowerCase().replace(/\\/g, '/');
}

export function withFileLock(filePath, actionFn) {
  var key = normalizeLockKey(filePath);
  if (!key) {
    return actionFn();
  }

  var conflictingPromises = [];
  for (var existingKey in _locks) {
    if (existingKey === key || key.startsWith(existingKey + '/') || existingKey.startsWith(key + '/')) {
      if (_locks[existingKey]) {
        conflictingPromises.push(_locks[existingKey]);
      }
    }
  }

  var waitPromise = conflictingPromises.length > 0 ? Promise.all(conflictingPromises) : Promise.resolve();

  var resolveTail = null;
  function captureTailResolve(res) {
    resolveTail = res;
  }
  var tailPromise = new Promise(captureTailResolve);

  // Synchronously reserve key in lock table
  _locks[key] = tailPromise;

  async function executeLocked() {
    try {
      return await actionFn();
    } finally {
      if (_locks[key] === tailPromise) {
        delete _locks[key];
      }
      if (resolveTail) {
        resolveTail();
      }
    }
  }

  return waitPromise.then(executeLocked, executeLocked);
}

export function clearAllLocks() {
  _locks = {};
}
