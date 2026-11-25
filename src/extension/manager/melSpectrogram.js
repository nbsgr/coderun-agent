// melSpectrogram.js
// Pure-JS 128-bin Log-Mel spectrogram extractor matching NeMo / Nemotron genai_config.json.
// Strict traditional function declarations only.

var FFT_SIZE = 512;
var WIN_LENGTH = 400;
var HOP_LENGTH = 160;
var NUM_MELS = 128;
var SAMPLE_RATE = 16000;
var PREEMPH = 0.97;
var LOG_EPS = 5.96046448e-08;

var cachedHannWindow = null;
var cachedMelBank = null;
var cachedCosTable = null;
var cachedSinTable = null;

function hzToMelSlaney(hz) {
  var fSp = 200.0 / 3.0;
  var minLogHz = 1000.0;
  var minLogMel = minLogHz / fSp;
  var logStep = Math.log(6.4) / 27.0;
  if (hz < minLogHz) {
    return hz / fSp;
  }
  return minLogMel + Math.log(hz / minLogHz) / logStep;
}

function melToHzSlaney(mel) {
  var fSp = 200.0 / 3.0;
  var minLogHz = 1000.0;
  var minLogMel = minLogHz / fSp;
  var logStep = Math.log(6.4) / 27.0;
  if (mel < minLogMel) {
    return mel * fSp;
  }
  return minLogHz * Math.exp(logStep * (mel - minLogMel));
}

function getHannWindow() {
  if (cachedHannWindow) return cachedHannWindow;
  var win = new Float32Array(FFT_SIZE);
  var padLeft = Math.floor((FFT_SIZE - WIN_LENGTH) / 2);
  var i;
  for (i = 0; i < WIN_LENGTH; i++) {
    win[padLeft + i] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / WIN_LENGTH));
  }
  cachedHannWindow = win;
  return win;
}

function getMelFilterBank() {
  if (cachedMelBank) return cachedMelBank;
  var numBins = Math.floor(FFT_SIZE / 2) + 1;
  var bank = new Float32Array(NUM_MELS * numBins);
  var melMin = hzToMelSlaney(0.0);
  var melMax = hzToMelSlaney(SAMPLE_RATE / 2.0);
  var melPoints = new Float64Array(NUM_MELS + 2);
  var i;
  var m;
  var k;

  for (i = 0; i < NUM_MELS + 2; i++) {
    melPoints[i] = melToHzSlaney(melMin + ((melMax - melMin) * i) / (NUM_MELS + 1));
  }

  for (m = 0; m < NUM_MELS; m++) {
    var fLeft = melPoints[m];
    var fCenter = melPoints[m + 1];
    var fRight = melPoints[m + 2];
    var enorm = 2.0 / Math.max(1e-12, fRight - fLeft);

    for (k = 0; k < numBins; k++) {
      var freq = (k * SAMPLE_RATE) / FFT_SIZE;
      var weight = 0.0;
      if (freq >= fLeft && freq <= fCenter && fCenter > fLeft) {
        weight = (freq - fLeft) / (fCenter - fLeft);
      } else if (freq > fCenter && freq <= fRight && fRight > fCenter) {
        weight = (fRight - freq) / (fRight - fCenter);
      }
      bank[m * numBins + k] = weight * enorm;
    }
  }

  cachedMelBank = bank;
  return bank;
}

function ensureFftTables() {
  if (cachedCosTable && cachedSinTable) return;
  var half = FFT_SIZE / 2;
  cachedCosTable = new Float64Array(half);
  cachedSinTable = new Float64Array(half);
  var i;
  for (i = 0; i < half; i++) {
    var angle = (-2.0 * Math.PI * i) / FFT_SIZE;
    cachedCosTable[i] = Math.cos(angle);
    cachedSinTable[i] = Math.sin(angle);
  }
}

function computePowerSpectrum512(realBuf, imagBuf) {
  ensureFftTables();
  var n = FFT_SIZE;
  var i;
  var j = 0;
  var temp;

  for (i = 0; i < n; i++) {
    if (i < j) {
      temp = realBuf[i];
      realBuf[i] = realBuf[j];
      realBuf[j] = temp;
      temp = imagBuf[i];
      imagBuf[i] = imagBuf[j];
      imagBuf[j] = temp;
    }
    var m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  var size = 2;
  while (size <= n) {
    var halfSize = size >> 1;
    var tabStep = n / size;
    for (i = 0; i < n; i += size) {
      var k = 0;
      var jIdx;
      for (jIdx = i; jIdx < i + halfSize; jIdx++) {
        var l = jIdx + halfSize;
        var cosVal = cachedCosTable[k];
        var sinVal = cachedSinTable[k];
        var tRe = realBuf[l] * cosVal - imagBuf[l] * sinVal;
        var tIm = realBuf[l] * sinVal + imagBuf[l] * cosVal;
        realBuf[l] = realBuf[jIdx] - tRe;
        imagBuf[l] = imagBuf[jIdx] - tIm;
        realBuf[jIdx] += tRe;
        imagBuf[jIdx] += tIm;
        k += tabStep;
      }
    }
    size <<= 1;
  }

  var numBins = (n >> 1) + 1;
  var power = new Float32Array(numBins);
  for (i = 0; i < numBins; i++) {
    power[i] = realBuf[i] * realBuf[i] + imagBuf[i] * imagBuf[i];
  }
  return power;
}

export function extractLogMelFrames(samples, prevSample) {
  if (!samples || samples.length === 0) {
    return { frames: new Float32Array(0), numFrames: 0, lastSample: prevSample || 0 };
  }

  var len = samples.length;
  var pre = new Float32Array(len);
  var prev = typeof prevSample === 'number' ? prevSample : 0;
  var i;

  for (i = 0; i < len; i++) {
    var s = samples[i];
    pre[i] = s - PREEMPH * prev;
    prev = s;
  }

  var pad = Math.floor(FFT_SIZE / 2);
  var padded = new Float32Array(len + 2 * pad);
  padded.set(pre, pad);

  var numFrames = Math.floor(len / HOP_LENGTH);
  if (numFrames < 1) {
    return { frames: new Float32Array(0), numFrames: 0, lastSample: prev };
  }

  var win = getHannWindow();
  var bank = getMelFilterBank();
  var numBins = (FFT_SIZE >> 1) + 1;
  var frames = new Float32Array(numFrames * NUM_MELS);
  var realBuf = new Float64Array(FFT_SIZE);
  var imagBuf = new Float64Array(FFT_SIZE);
  var f;
  var m;
  var k;

  for (f = 0; f < numFrames; f++) {
    var start = f * HOP_LENGTH;
    for (i = 0; i < FFT_SIZE; i++) {
      realBuf[i] = padded[start + i] * win[i];
      imagBuf[i] = 0.0;
    }

    var power = computePowerSpectrum512(realBuf, imagBuf);
    var outOffset = f * NUM_MELS;

    for (m = 0; m < NUM_MELS; m++) {
      var bankOffset = m * numBins;
      var energy = 0.0;
      for (k = 0; k < numBins; k++) {
        energy += bank[bankOffset + k] * power[k];
      }
      frames[outOffset + m] = Math.log(energy + LOG_EPS);
    }
  }

  return { frames: frames, numFrames: numFrames, lastSample: prev };
}

