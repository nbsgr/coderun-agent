// terminalManager.js — VS Code Terminal with Shell Integration
// Executes commands in the REAL VS Code Integrated Terminal and streams
// output live to the chat UI via shell integration events.

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';

var activeTerminal = null;
var terminalListeners = [];
var pendingExecutions = {};
var executionCounter = 0;
var sendEventCallback = null;
var _lastSessionOutput = '';  // Holds stdout from the last/most recent terminal execution
var _lastSessionActive = false; // Whether the session is still active
var _lastCheckedPosition = 0; // Tracks the last position returned by checkTerminalOutput() to avoid returning duplicate output
var activeExecId = null; // Tracks the currently running terminal execution ID for interactive routing
var _pendingInteractiveReader = null; // Stores the async iterator reader when process is waiting for input
var _pendingInteractiveExecution = null; // Stores the execution object for exit code retrieval

// ── Shell detection ────────────────────────────────────────
// Auto-detect the shell name from VS Code's terminal API.
function detectShellName(terminal) {
  try {
    var vscodeShell = vscode.env.shell || '';
    if (vscodeShell) {
      var shellName = path.basename(vscodeShell).toLowerCase();
      if (shellName.includes('powershell')) return 'powershell';
      if (shellName.includes('pwsh')) return 'powershell';
      if (shellName.includes('cmd')) return 'cmd';
      if (shellName.includes('bash')) return 'bash';
      if (shellName.includes('zsh')) return 'zsh';
      if (shellName.includes('fish')) return 'fish';
      if (shellName.includes('wsl')) return 'wsl';
    }
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }

  if (!terminal) return guessShellFromEnv();
  try {
    var creationOptions = terminal.creationOptions;
    if (creationOptions) {
      var shellPath = creationOptions.shellPath || '';
      if (shellPath) {
        var shellName = path.basename(shellPath).toLowerCase();
        if (shellName.includes('powershell')) return 'powershell';
        if (shellName.includes('pwsh')) return 'powershell';
        if (shellName.includes('cmd')) return 'cmd';
        if (shellName.includes('bash')) return 'bash';
        if (shellName.includes('zsh')) return 'zsh';
        if (shellName.includes('fish')) return 'fish';
        if (shellName.includes('wsl')) return 'wsl';
        return shellName.replace(/\.exe$/, '');
      }
    }
  } catch (_) {
    // Intentionally ignored to allow safe execution fallback
  }
  return guessShellFromEnv();
}

function guessShellFromEnv() {
  var platform = process.platform;
  if (platform === 'win32') {
    try {
      if (process.env.PSModulePath) return 'powershell';
    } catch (_) {
      // Intentionally ignored to allow safe execution fallback
    }

    if (process.env.SHELL) {
      var sh = path.basename(process.env.SHELL).toLowerCase();
      if (sh.includes('bash')) return 'bash (Git Bash)';
      if (sh.includes('zsh')) return 'zsh';
    }
    try {
      var comspec = process.env.COMSPEC || '';
      if (comspec.toLowerCase().includes('cmd')) return 'cmd';
    } catch (_) {
      // Intentionally ignored to allow safe execution fallback
    }
    return 'powershell';
  }
  if (platform === 'darwin') {
    return process.env.SHELL ? path.basename(process.env.SHELL) : 'zsh';
  }
  if (process.env.WSL_DISTRO_NAME) return 'wsl';
  return process.env.SHELL ? path.basename(process.env.SHELL) : 'bash';
}

function getPlatform() {
  var p = process.platform;
  if (p === 'win32') return 'windows';
  if (p === 'darwin') return 'macos';
  return 'linux';
}

// ── ANSI escape sequence cleaner ────────────────────────────
function stripAnsi(text) {
  if (!text) return '';
  var cleaned = text
    .replace(/\x1B\]\d+(?:;[^\x1B]*)*(?:\x1B\\)/g, '')
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1B\][^\x1B]*[\x07\x1B]/g, '')
    .replace(/\x07/g, '')
    .replace(/\x1B[\x5D\x5B][^\x1B]*[\x07\x5C]/g, '')
    .replace(/\x1B[\[\]()][0-9;]*[~A-Za-z]/g, '')
    .replace(/\x1B[\[\]()]/g, '')
    .replace(/\x1B[^\[\]()\s]/g, '')
    .replace(/\]633;/g, '')
    .replace(/\]133;/g, '')
    .replace(/\]633;d;([^\x07\x1B]+)/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  return cleaned;
}

export function setSendEventCallback(callback) {
  sendEventCallback = callback;
}

export function getShellName() {
  var term = getTerminal();
  return detectShellName(term);
}

export function getPlatformName() {
  return getPlatform();
}

export function getTerminal() {
  if (activeTerminal && !activeTerminal.exitStatus) {
    return activeTerminal;
  }
  var existing = null;
  var allTerms = vscode.window.terminals;
  for (var i = 0; i < allTerms.length; i++) {
    if (allTerms[i].name === 'CodeRun Agent') {
      existing = allTerms[i];
      break;
    }
  }
  if (existing && !existing.exitStatus) {
    activeTerminal = existing;
    return activeTerminal;
  }
  var workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
  activeTerminal = vscode.window.createTerminal({
    name: 'CodeRun Agent',
    cwd: workspaceFolder,
    location: vscode.TerminalLocation.Panel
  });
  return activeTerminal;
}

function handleShellIntegrationChange(disposable, resolve, event) {
  if (event.terminal === activeTerminal && event.shellIntegration) {
    disposable.ref.dispose();
    resolve(true);
  }
}

function handleShellIntegrationTimeout(disposable, resolve) {
  disposable.ref.dispose();
  resolve(!!activeTerminal.shellIntegration);
}

function executeShellIntegrationPromise(ms, resolve) {
  var disposable = { ref: null };
  var changeCb = handleShellIntegrationChange.bind(null, disposable, resolve);
  disposable.ref = vscode.window.onDidChangeTerminalShellIntegration(changeCb);
  
  var timeoutCb = handleShellIntegrationTimeout.bind(null, disposable, resolve);
  setTimeout(timeoutCb, ms);
}

export async function waitForShellIntegration(ms) {
  ms = ms || 5000;
  if (!activeTerminal) return false;
  if (activeTerminal.shellIntegration) return true;
  return new Promise(executeShellIntegrationPromise.bind(null, ms));
}

function onShellIntegrationChange(event) {
  var terminal = event.terminal;
  var shellIntegration = event.shellIntegration;
  console.log('[TERMINAL] Shell integration changed for:', terminal.name);
  if (terminal === activeTerminal && shellIntegration) {
    console.log('[TERMINAL] Shell integration ready for CodeRun terminal');
  }
}

function onDidCloseTerminalHandler(terminal) {
  if (terminal === activeTerminal) {
    activeTerminal = null;
    for (var id in pendingExecutions) {
      if (sendEventCallback) {
        sendEventCallback({
          type: 'terminal_error',
          terminalId: id,
          message: 'Terminal was closed before command completed.'
        });
      }
      delete pendingExecutions[id];
    }
  }
}

export function registerTerminalListeners(context) {
  if (!vscode.window.onDidChangeTerminalShellIntegration) {
    console.log('[TERMINAL] Shell integration change events are not available in this VS Code version.');
    return;
  }

  var changeSub = vscode.window.onDidChangeTerminalShellIntegration(onShellIntegrationChange);
  terminalListeners.push(changeSub);
  context.subscriptions.push(changeSub);

  var closeSub = vscode.window.onDidCloseTerminal(onDidCloseTerminalHandler);
  terminalListeners.push(closeSub);
  context.subscriptions.push(closeSub);
}

function processTerminalChunk(execId, result) {
  if (!result || result.done) return true;
  var chunk = result.value;
  if (chunk) {
    var cleanChunk = stripAnsi(String(chunk));
    if (cleanChunk) {
      _lastSessionOutput += cleanChunk;
      console.log('[TERMINAL] Background reader: new output for', execId, 'length:', cleanChunk.length);
      if (sendEventCallback) {
        sendEventCallback({
          type: 'terminal_output',
          terminalId: execId,
          chunk: cleanChunk
        });
      }
    }
  }
  return false;
}

function resolveBgTimeout(resolve) {
  resolve({ done: false, value: undefined, _bgTimeout: true });
}

function executeBgTimeoutPromise(ms, resolve) {
  setTimeout(resolveBgTimeout.bind(null, resolve), ms);
}

function createBgTimeoutPromise(ms) {
  return new Promise(executeBgTimeoutPromise.bind(null, ms));
}

function resolveNullValue(resolve) {
  resolve(null);
}

function executeNullTimeoutPromise(ms, resolve) {
  setTimeout(resolveNullValue.bind(null, resolve), ms);
}

function createNullTimeoutPromise(ms) {
  return new Promise(executeNullTimeoutPromise.bind(null, ms));
}

async function continueReadingInBackground(execId, reader, execution, shellName, platformName, cwd, command, startedAt, orphanedNextPromise) {
  console.log('[TERMINAL] Starting background reader for interactive session:', execId);
  _pendingInteractiveReader = reader;
  _pendingInteractiveExecution = execution;

  try {
    if (orphanedNextPromise) {
      console.log('[TERMINAL] Background reader: awaiting orphaned nextPromise for', execId);
      var firstResult = await Promise.race([
        orphanedNextPromise,
        createBgTimeoutPromise(60000)
      ]);

      if (firstResult._bgTimeout) {
        if (!_lastSessionActive) {
          console.log('[TERMINAL] Background reader: session cancelled during orphan wait, stopping');
          _pendingInteractiveReader = null;
          _pendingInteractiveExecution = null;
          return;
        }
      } else {
        var streamEnded = processTerminalChunk(execId, firstResult);
        if (streamEnded) {
          console.log('[TERMINAL] Background reader: stream ended on orphaned promise for', execId);
          _lastSessionActive = false;
          activeExecId = null;
          _pendingInteractiveReader = null;
          _pendingInteractiveExecution = null;

          var exitCode = null;
          try {
            exitCode = await Promise.race([
              execution.exitCode,
              createNullTimeoutPromise(5000)
            ]);
          } catch (_) {
            // Intentionally ignored to allow safe execution fallback
          }

          var durationMs = Date.now() - startedAt;
          console.log('[TERMINAL] Background reader: process exited for', execId, 'exitCode:', exitCode);
          if (sendEventCallback) {
            sendEventCallback({
              type: 'terminal_exit',
              terminalId: execId,
              exitCode: exitCode,
              duration: durationMs,
              shell: shellName,
              platform: platformName,
              cwd: cwd,
              command: command
            });
          }
          return;
        }
      }
    }

    while (true) {
      if (!_lastSessionActive) {
        console.log('[TERMINAL] Background reader: session no longer active, stopping loop for', execId);
        break;
      }
      var raceResult = await Promise.race([
        reader.next(),
        createBgTimeoutPromise(60000)
      ]);

      if (raceResult._bgTimeout) {
        if (!_lastSessionActive) {
          console.log('[TERMINAL] Background reader: session no longer active, stopping');
          break;
        }
        continue;
      }

      var streamEnded = processTerminalChunk(execId, raceResult);
      if (streamEnded) break;
    }

    console.log('[TERMINAL] Background reader: stream ended for', execId, '— awaiting exitCode');
    var exitCode = null;
    try {
      exitCode = await Promise.race([
        execution.exitCode,
        createNullTimeoutPromise(5000)
      ]);
    } catch (_) {
      // Intentionally ignored to allow safe execution fallback
    }

    _lastSessionActive = false;
    activeExecId = null;
    _pendingInteractiveReader = null;
    _pendingInteractiveExecution = null;

    var durationMs = Date.now() - startedAt;
    console.log('[TERMINAL] Background reader: process exited for', execId, 'exitCode:', exitCode);

    if (sendEventCallback) {
      sendEventCallback({
        type: 'terminal_exit',
        terminalId: execId,
        exitCode: exitCode,
        duration: durationMs,
        shell: shellName,
        platform: platformName,
        cwd: cwd,
        command: command
      });
    }
  } catch (err) {
    console.error('[TERMINAL] Background reader error for', execId, ':', err.message);
    _lastSessionActive = false;
    activeExecId = null;
    _pendingInteractiveReader = null;
    _pendingInteractiveExecution = null;
  }
}

// Heuristic: scan text for common interactive patterns.
function detectPrompt(text) {
  if (!text) return { interactive: false, promptDetected: false };
  var lines = text.split('\n');
  var interactive = false;
  var promptDetected = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();

    if (/[○●◉◎⦿⊙⊚]/.test(line)) {
      interactive = true;
      promptDetected = true;
    }

    if (/[↑↓←→]/.test(line)) {
      interactive = true;
      promptDetected = true;
    }

    if (/[:：]\s*$/.test(line) && line.length < 120) {
      interactive = true;
      promptDetected = true;
    }

    if (/\([yYnN]\/[yYnN]\)|\[[yYnN]\/[yYnN]\]/.test(line)) {
      interactive = true;
      promptDetected = true;
    }

    if (/\[ ?\d+ ?\]|\( ?\d+ ?\)/.test(line) && lines.length - i < 30) {
      interactive = true;
    }

    if (/^(Select|Choose|Pick)\b/i.test(line)) {
      interactive = true;
      promptDetected = true;
    }

    if (/\?\s*$/.test(line) && line.length < 150) {
      interactive = true;
      promptDetected = true;
    }
  }

  return { interactive: interactive, promptDetected: promptDetected };
}

function handleBgStartTimeout(execId, shellName, platformName, cwd, startedAt) {
  if (sendEventCallback) {
    sendEventCallback({
      type: 'terminal_exit',
      terminalId: execId,
      exitCode: null,
      duration: Date.now() - startedAt,
      shell: shellName,
      platform: platformName,
      cwd: cwd,
      background: true,
      message: 'Process started in the background.'
    });
  }
}

function handleNextPromiseResolve(timerCtx, r) {
  if (timerCtx.id) {
    clearTimeout(timerCtx.id);
    timerCtx.id = null;
  }
  return r;
}

function resolveIdleTimeout(resolve) {
  resolve({ done: true, value: undefined, _idleTimeout: true });
}

function executeIdleTimeoutPromise(timerCtx, ms, resolve) {
  timerCtx.id = setTimeout(resolveIdleTimeout.bind(null, resolve), ms);
}

function createIdleTimeoutPromise(timerCtx, ms) {
  return new Promise(executeIdleTimeoutPromise.bind(null, timerCtx, ms));
}

function checkInteractiveCommand(cmd) {
  var lower = String(cmd || '').toLowerCase();
  var interactiveKeywords = [
    'cmd', 'powershell', 'pwsh', 'bash', 'sh', 'zsh',
    'python', 'node', 'npm start', 'npm run', 'nodemon', 'flask run', 'deno',
    'ssh', 'ftp', 'telnet',
    'read ', 'set /p', 'choice', 'input(', 'raw_input(',
    'ping -t', 'ping localhost -t'
  ];
  for (var i = 0; i < interactiveKeywords.length; i++) {
    var kw = interactiveKeywords[i];
    var idx = lower.indexOf(kw);
    if (idx !== -1) {
      if (idx === 0) return true;
      var prevChar = lower.charAt(idx - 1);
      if (prevChar === ' ' || prevChar === '&' || prevChar === '|' || prevChar === ';') {
        return true;
      }
    }
  }
  return false;
}

function handleInteractiveExitTimeout(execId, shellName, platformName, cwd, startedAt) {
  if (sendEventCallback) {
    sendEventCallback({
      type: 'terminal_exit',
      terminalId: execId,
      exitCode: 0,
      duration: Date.now() - startedAt,
      shell: shellName,
      platform: platformName,
      cwd: cwd,
      message: 'Interactive session active in terminal.'
    });
  }
}

function handleExecFileResult(resolve, error, cpStdout, cpStderr) {
  if (error) {
    resolve({
      stdout: cpStdout || '',
      stderr: cpStderr || '',
      exitCode: error.code != null ? error.code : (error.killed ? -1 : 1)
    });
  } else {
    resolve({
      stdout: cpStdout || '',
      stderr: cpStderr || '',
      exitCode: 0
    });
  }
}

function executeFilePromise(shellExe, fullArgs, cwd, timeout, resolve) {
  var options = {
    cwd: cwd || undefined,
    timeout: timeout * 1000,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  };
  execFile(shellExe, fullArgs, options, handleExecFileResult.bind(null, resolve));
}

function createExecFilePromise(shellExe, fullArgs, cwd, timeout) {
  return new Promise(executeFilePromise.bind(null, shellExe, fullArgs, cwd, timeout));
}

export async function executeCommand(command, timeout, background, isInteractive) {
  timeout = timeout || 30;
  var terminal = getTerminal();
  terminal.show(true);

  var shellName = detectShellName(terminal);
  var platformName = getPlatform();
  var cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || '';
  var startedAt = Date.now();
  var useInteractiveTimeout = isInteractive === true || (isInteractive !== false && checkInteractiveCommand(command));

  if (background) {
    console.log('[TERMINAL] Running command in background:', command);
    terminal.sendText(command, true);

    var execId = 'term_bg_' + (++executionCounter);
    if (sendEventCallback) {
      sendEventCallback({
        type: 'terminal_start',
        terminalId: execId,
        command: command,
        shell: shellName,
        platform: platformName,
        cwd: cwd,
        background: true
      });
      setTimeout(handleBgStartTimeout.bind(null, execId, shellName, platformName, cwd, startedAt), 1000);
    }

    return {
      shell: shellName,
      platform: platformName,
      command: command,
      stdout: '',
      stderr: '',
      exitCode: null,
      durationMs: Date.now() - startedAt,
      success: true,
      workingDirectory: cwd,
      method: 'background',
      message: 'Command started in the background.'
    };
  }

  var shellIntegration = terminal.shellIntegration;
  if (!shellIntegration) {
    await waitForShellIntegration(3000);
    shellIntegration = terminal.shellIntegration;
  }

  if (shellIntegration) {
    console.log('[TERMINAL] Executing via shell integration:', command, 'useInteractiveTimeout:', useInteractiveTimeout);
    var stdout = '';
    var stderr = '';
    try {
      var execId = 'term_direct_' + (++executionCounter);
      activeExecId = execId;
      var execution = shellIntegration.executeCommand(command);
      var timeoutAt = startedAt + timeout * 1000;

      if (sendEventCallback) {
        sendEventCallback({
          type: 'terminal_start',
          terminalId: execId,
          command: command,
          shell: shellName,
          platform: platformName,
          cwd: cwd
        });
      }

      if (!execution || typeof execution.read !== 'function') {
        throw new Error('Shell integration did not return a readable execution stream.');
      }
      var iterable = execution.read();
      if (!iterable || typeof iterable[Symbol.asyncIterator] !== 'function') {
        throw new Error('Shell integration read() did not return an async iterable.');
      }

      console.log('[TERMINAL] Entering for-await loop for', execId);
      var reader = iterable[Symbol.asyncIterator]();
      var chunkCount = 0;
      var idleDetected = false;

      try {
        var IDLE_TIMEOUT_MS = useInteractiveTimeout ? 3000 : (timeout * 1000 + 5000);

        while (true) {
          var nextPromise = reader.next();
          var raceResult = null;
          if (useInteractiveTimeout) {
            var timerCtx = { id: null };
            raceResult = await Promise.race([
              nextPromise.then(handleNextPromiseResolve.bind(null, timerCtx)),
              createIdleTimeoutPromise(timerCtx, IDLE_TIMEOUT_MS)
            ]);
          } else {
            var remainingMs = timeoutAt - Date.now();
            if (remainingMs <= 0) {
              throw new Error('Command timed out after ' + timeout + ' seconds.');
            }
            var timerCtx2 = { id: null };
            raceResult = await Promise.race([
              nextPromise.then(handleNextPromiseResolve.bind(null, timerCtx2)),
              createIdleTimeoutPromise(timerCtx2, Math.max(remainingMs, 1000))
            ]);
          }

          if (raceResult._idleTimeout) {
            if (useInteractiveTimeout) {
              idleDetected = true;
              break;
            } else {
              throw new Error('Command timed out after ' + timeout + ' seconds.');
            }
          }

          if (raceResult.done) break;

          var chunk = raceResult.value;
          chunkCount++;
          console.log('[TERMINAL] Chunk #' + chunkCount + ' for', execId, 'length:', String(chunk || '').length);
          var text = String(chunk || '');
          var cleanChunk = stripAnsi(text);
          stdout += cleanChunk;
          if (sendEventCallback && cleanChunk) {
            sendEventCallback({
              type: 'terminal_output',
              terminalId: execId,
              chunk: cleanChunk
            });
          }

          if (Date.now() > timeoutAt) {
            throw new Error('Command timed out after ' + timeout + ' seconds.');
          }
        }
        _lastSessionOutput = stdout;
        _lastSessionActive = (idleDetected === true);
      } catch (streamErr) {
        console.log('[TERMINAL] for-await loop threw for', execId, ':', streamErr.message, 'chunks received:', chunkCount);
        throw streamErr;
      }

      if (idleDetected) {
        console.log('[TERMINAL] Idle timeout for', execId, '- process waiting for input');
        var durationMs2 = Date.now() - startedAt;
        var promptCheck = detectPrompt(stdout);

        continueReadingInBackground(execId, reader, execution, shellName, platformName, cwd, command, startedAt, nextPromise);

        if (sendEventCallback) {
          sendEventCallback({
            type: 'terminal_exit',
            terminalId: execId,
            exitCode: null,
            duration: durationMs2,
            shell: shellName,
            platform: platformName,
            cwd: cwd,
            command: command,
            waitingForInput: true,
            interactive: promptCheck.interactive,
            promptDetected: promptCheck.promptDetected
          });
        }
        console.log('[TERMINAL] Returning partial result for', execId, '(waiting for input)');
        return {
          shell: shellName,
          platform: platformName,
          command: command,
          stdout: stdout,
          stderr: stderr,
          exitCode: null,
          durationMs: durationMs2,
          success: true,
          workingDirectory: cwd,
          method: 'shell_integration',
          waitingForInput: true,
          interactive: promptCheck.interactive,
          promptDetected: promptCheck.promptDetected,
          status: 'waiting_for_input'
        };
      }

      console.log('[TERMINAL] for-await loop COMPLETED for', execId, 'chunks:', chunkCount);
      console.log('[TERMINAL] Awaiting exitCode for', execId);
      var exitCode = await execution.exitCode;
      console.log('[TERMINAL] exitCode received for', execId, ':', exitCode);
      var durationMs = Date.now() - startedAt;
      console.log('[TERMINAL] Sending terminal_exit for', execId, 'exitCode:', exitCode, 'duration:', durationMs);
      if (sendEventCallback) {
        sendEventCallback({
          type: 'terminal_exit',
          terminalId: execId,
          exitCode: exitCode,
          duration: durationMs,
          shell: shellName,
          platform: platformName,
          cwd: cwd,
          command: command
        });
      }

      console.log('[TERMINAL] Returning result for', execId);
      var promptCheck = detectPrompt(stdout);
      activeExecId = null;
      return {
        shell: shellName,
        platform: platformName,
        command: command,
        stdout: stdout,
        stderr: stderr,
        exitCode: exitCode,
        durationMs: durationMs,
        success: exitCode != null ? (exitCode === 0) : true,
        workingDirectory: cwd,
        method: 'shell_integration',
        interactive: promptCheck.interactive,
        promptDetected: promptCheck.promptDetected,
        status: exitCode != null ? (exitCode === 0 ? 'completed' : 'failed') : 'completed'
      };
    } catch (err) {
      console.error('[TERMINAL] Shell integration executeCommand failed:', err);
      activeExecId = null;
      _lastSessionOutput = stdout;
      _lastSessionActive = false;
      if (sendEventCallback) {
        sendEventCallback({
          type: 'terminal_error',
          terminalId: 'term_error_' + executionCounter,
          message: err.message,
          shell: shellName,
          platform: platformName
        });
      }
    }
  }

  console.log('[TERMINAL] Shell integration unavailable — using child_process fallback:', command);
  terminal.sendText(command, true);

  if (checkInteractiveCommand(command)) {
    var execId = 'term_interactive_' + (++executionCounter);
    if (sendEventCallback) {
      sendEventCallback({
        type: 'terminal_start',
        terminalId: execId,
        command: command,
        shell: shellName,
        platform: platformName,
        cwd: cwd,
        interactive: true
      });
      setTimeout(handleInteractiveExitTimeout.bind(null, execId, shellName, platformName, cwd, startedAt), 1000);
    }
    return {
      shell: shellName,
      platform: platformName,
      command: command,
      stdout: 'Interactive command running in VS Code terminal.',
      stderr: '',
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      success: true,
      workingDirectory: cwd,
      interactive: true,
      message: 'Interactive command executed in VS Code terminal.'
    };
  }

  var execId = 'term_fallback_' + (++executionCounter);
  activeExecId = execId;
  if (sendEventCallback) {
    sendEventCallback({
      type: 'terminal_start',
      terminalId: execId,
      command: command,
      shell: shellName,
      platform: platformName,
      cwd: cwd,
      fallback: true
    });
  }

  var shellExe = '';
  var shellArg = '';
  var lowerShell = shellName.toLowerCase();

  if (lowerShell.includes('powershell') || lowerShell.includes('pwsh')) {
    shellExe = process.env.PWSH_EXE || 'powershell.exe';
    shellArg = '-NoProfile -NonInteractive -Command';
  } else if (lowerShell.includes('cmd')) {
    shellExe = process.env.COMSPEC || 'cmd.exe';
    shellArg = '/c';
  } else if (lowerShell.includes('wsl')) {
    shellExe = 'wsl.exe';
    shellArg = '--';
  } else {
    shellExe = process.env.SHELL || 'bash';
    shellArg = '-c';
  }

  try {
    var stdout = '';
    var stderr = '';
    var cpExitCode = null;

    var fullArgs = shellArg.split(' ').concat([command]);
    var cpResult = await createExecFilePromise(shellExe, fullArgs, cwd, timeout);

    stdout = cpResult.stdout;
    stderr = cpResult.stderr;
    cpExitCode = cpResult.exitCode;
    var durationMs = Date.now() - startedAt;

    stdout = stripAnsi(stdout);
    stderr = stripAnsi(stderr);

    if (sendEventCallback && stdout) {
      sendEventCallback({
        type: 'terminal_output',
        terminalId: execId,
        chunk: stdout
      });
    }
    if (sendEventCallback && stderr) {
      sendEventCallback({
        type: 'terminal_output',
        terminalId: execId,
        chunk: stderr
      });
    }

    if (sendEventCallback) {
      sendEventCallback({
        type: 'terminal_exit',
        terminalId: execId,
        exitCode: cpExitCode,
        duration: durationMs,
        shell: shellName,
        platform: platformName,
        cwd: cwd,
        command: command,
        fallback: true
      });
    }

    var promptCheck = detectPrompt(stdout);
    activeExecId = null;
    return {
      shell: shellName,
      platform: platformName,
      command: command,
      stdout: stdout,
      stderr: stderr,
      exitCode: cpExitCode,
      durationMs: durationMs,
      success: cpExitCode === 0,
      workingDirectory: cwd,
      method: 'sendText',
      interactive: promptCheck.interactive,
      promptDetected: promptCheck.promptDetected,
      status: cpExitCode != null ? (cpExitCode === 0 ? 'completed' : 'failed') : 'completed'
    };
  } catch (cpErr) {
    console.error('[TERMINAL] child_process fallback also failed:', cpErr.message);
    activeExecId = null;
    var fallbackDuration = Date.now() - startedAt;

    if (sendEventCallback) {
      sendEventCallback({
        type: 'terminal_error',
        terminalId: execId,
        message: cpErr.message,
        shell: shellName,
        platform: platformName
      });
    }

    return {
      shell: shellName,
      platform: platformName,
      command: command,
      stdout: '',
      stderr: cpErr.message,
      exitCode: -1,
      durationMs: fallbackDuration,
      success: false,
      workingDirectory: cwd,
      method: 'sendText',
      error: cpErr.message
    };
  }
}

export function executeCommandLegacy(command) {
  if (!command) return;
  var terminal = getTerminal();
  terminal.show(true);
  terminal.sendText(command, true);
}

export function writeOutput(text, outputType) {
  if (!text) return;
  var terminal = getTerminal();
  terminal.show(true);
  var prefix = outputType === 'stderr' ? '[ERROR] ' : '[OUTPUT] ';
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.trim()) {
      terminal.sendText('echo "' + prefix + line.replace(/"/g, '\"') + '"', true);
    }
  }
}

export function dispose() {
  for (var i = 0; i < terminalListeners.length; i++) {
    try {
      terminalListeners[i].dispose();
    } catch (_) {
      // Intentionally ignored to allow safe execution fallback
    }
  }
  terminalListeners = [];
  if (activeTerminal) {
    try {
      activeTerminal.dispose();
    } catch (_) {
      // Intentionally ignored to allow safe execution fallback
    }
    activeTerminal = null;
  }
  pendingExecutions = {};
  sendEventCallback = null;
}

export function onTerminalClosed(terminal) {
  if (terminal === activeTerminal) {
    activeTerminal = null;
  }
}

export function resetTerminal() {
  if (activeTerminal) {
    try {
      activeTerminal.dispose();
    } catch (_) {
      // Intentionally ignored to allow safe execution fallback
    }
    activeTerminal = null;
  }
  _lastSessionOutput = '';
  _lastSessionActive = false;
  _lastCheckedPosition = 0;
}

export function hasShellIntegration() {
  return activeTerminal && activeTerminal.shellIntegration ? true : false;
}

export function sendTerminalInput(text) {
  var terminal = getTerminal();
  terminal.show(true);
  terminal.sendText(text, true);
  return { success: true, message: 'Input sent to terminal: ' + text };
}

export async function checkTerminalOutput() {
  if (_pendingInteractiveReader && _lastSessionActive) {
    await createNullTimeoutPromise(1500);
  }

  var fullOutput = _lastSessionOutput || '';
  var stderr = '';
  var shellName = activeTerminal ? detectShellName(activeTerminal) : 'unknown';
  var platformName = getPlatform();
  var startedAt = Date.now();

  var newOutput = fullOutput.substring(_lastCheckedPosition);
  _lastCheckedPosition = fullOutput.length;

  var isWaiting = _lastSessionActive;
  var exitCode = null;

  var promptCheck = detectPrompt(newOutput);
  return {
    shell: shellName,
    platform: platformName,
    stdout: newOutput,
    stderr: stderr,
    exitCode: exitCode,
    durationMs: Date.now() - startedAt,
    success: true,
    status: isWaiting ? 'waiting_for_input' : 'active',
    waitingForInput: isWaiting,
    interactive: promptCheck.interactive,
    promptDetected: promptCheck.promptDetected
  };
}

export async function stopTerminal() {
  var terminal = getTerminal();
  terminal.show(true);

  console.log('[TERMINAL] Sending Ctrl+C interrupt');

  await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', { text: '\u0003' });

  if (sendEventCallback) {
    sendEventCallback({
      type: 'terminal_output',
      terminalId: activeExecId || ('term_stop_' + Date.now()),
      chunk: '^C\n'
    });
  }

  _lastSessionActive = false;
  activeExecId = null;
  _pendingInteractiveReader = null;
  _pendingInteractiveExecution = null;

  return { success: true, message: 'Sent Ctrl+C to stop running process.' };
}
