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
