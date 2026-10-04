// chats-media-manager.js (UI side)
// Manages HTML5 media player controls, progress scrubber, and workspace exports
// Strict traditional function declarations only

import { vscode } from '../controller/vscode-api.js';

export function formatMediaTime(seconds) {
  var totalSec = Math.floor(seconds || 0);
  var m = Math.floor(totalSec / 60);
  var s = totalSec % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

export function saveMediaToWorkspaceFromUi(sourcePath, targetRelPath, reqId) {
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'saveMediaToWorkspace',
      sourcePath: sourcePath,
      targetRelPath: targetRelPath,
      reqId: reqId
    });
  }
}

export function bindVideoCardEvents(card) {
  if (!card) return;
  var video = card.querySelector('video');
  var playBtn = card.querySelector('.cr-video-play-btn');
  var timeDisplay = card.querySelector('.cr-video-time');
  var progressBar = card.querySelector('.cr-video-progress');

  if (video && playBtn) {
    playBtn.addEventListener('click', function onPlayToggle() {
      if (video.paused) {
        video.play();
        playBtn.textContent = '⏸';
      } else {
        video.pause();
        playBtn.textContent = '▶';
      }
    });
  }

  if (video && timeDisplay && progressBar) {
    video.addEventListener('timeupdate', function onTimeUpdate() {
      if (video.duration) {
        var pct = (video.currentTime / video.duration) * 100;
        progressBar.style.width = pct + '%';
        timeDisplay.textContent = formatMediaTime(video.currentTime) + ' / ' + formatMediaTime(video.duration);
      }
    });
  }
}

var pendingMediaElements = [];

export function requestMediaData(element, rawSrc) {
  if (!element || !rawSrc) return;
  pendingMediaElements.push({ element: element, src: rawSrc });
  if (vscode && typeof vscode.postMessage === 'function') {
    vscode.postMessage({
      type: 'getMediaData',
      path: rawSrc
    });
  }
}

export function handleMediaDataResult(message) {
  if (!message || !message.success || !message.dataUri) return;
  var cleanTarget = String(message.path || '').split('?')[0].split('#')[0];
  var targetBase = cleanTarget.split('/').pop().split('\\').pop();
  var remaining = [];

  for (var i = 0; i < pendingMediaElements.length; i++) {
    var item = pendingMediaElements[i];
    if (item && item.element) {
      var itemClean = String(item.src || '').split('?')[0].split('#')[0];
      var itemBase = itemClean.split('/').pop().split('\\').pop();
      if (itemClean === cleanTarget || itemBase === targetBase || (message.resolvedPath && itemClean.indexOf(targetBase) !== -1)) {
        if (item.element.tagName === 'IMG') {
          item.element.src = message.dataUri;
        } else if (item.element.tagName === 'VIDEO') {
          item.element.src = message.dataUri;
          item.element.load();
        }
      } else {
        remaining.push(item);
      }
    }
  }
  pendingMediaElements = remaining;

  if (typeof document !== 'undefined') {
    var allImgs = document.querySelectorAll('img[data-media-raw-src], img[data-media-src], video[data-media-raw-src], video[data-media-src]');
    for (var ai = 0; ai < allImgs.length; ai++) {
      var el = allImgs[ai];
      var elSrc = el.dataset.mediaRawSrc || el.dataset.mediaSrc || el.getAttribute('src') || '';
      var elClean = elSrc.split('?')[0].split('#')[0];
      var elBase = elClean.split('/').pop().split('\\').pop();
      if (elBase && (elBase === targetBase || elClean === cleanTarget)) {
        if (el.tagName === 'IMG') {
          el.src = message.dataUri;
        } else if (el.tagName === 'VIDEO') {
          el.src = message.dataUri;
          el.load();
        }
      }
    }
  }
}

if (typeof window !== 'undefined') {
  window.requestMediaData = requestMediaData;
}

