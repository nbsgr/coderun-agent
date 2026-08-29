// terminalManager.js — VS Code Terminal with Shell Integration
// Executes commands in isolated VS Code Integrated Terminals per chat session
// and streams output live to the chat UI via shell integration events.

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';

var _sessions = {}; // sessionId -> sessionState
var terminalListeners = [];
var executionCounter = 0;

function createSessionState(sessionId) {
  return {
    id: sessionId || 'default',
    terminal: null,
    lastSessionOutput: '',
    lastSessionActive: false,
    lastCheckedPosition: 0,
    activeExecId: null,
    activeChildProcess: null,
    backgroundTasks: {},
    pendingInteractiveReader: null,
    pendingInteractiveExecution: null,
    sendEventCallback: null
  };
}

export function getSession(sessionId) {
  var sid = sessionId || 'default';
  if (!_sessions[sid]) {
    _sessions[sid] = createSessionState(sid);
  }
  return _sessions[sid];
}

export function removeSession(sessionId) {
  if (!sessionId) return;
  var sess = _sessions[sessionId];
  if (sess) {
    if (sess.activeChildProcess) {
      killChildProcess(sess.activeChildProcess);
      sess.activeChildProcess = null;
    }
    if (sess.terminal) {
      try {
        sess.terminal.dispose();
      } catch (_) {
        // Intentionally ignored
      }
    }
  }
  delete _sessions[sessionId];
}

function killChildProcess(proc) {
  if (!proc) return;
  try {
    if (process.platform === 'win32' && proc.pid) {
      execFile('taskkill', ['/F', '/T', '/PID', String(proc.pid)], function onKillDone() {});
    } else {
      proc.kill('SIGTERM');
    }
  } catch (_) {
    // Intentionally ignored
  }
}

// ── Shell detection ────────────────────────────────────────
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
    // Intentionally ignored
  }

  if (!terminal) return guessShellFromEnv();
  try {
    var creationOptions = terminal.creationOptions;
    if (creationOptions) {
      var shellPath = creationOptions.shellPath || '';
      if (shellPath) {
        var sName = path.basename(shellPath).toLowerCase();
        if (sName.includes('powershell')) return 'powershell';
        if (sName.includes('pwsh')) return 'powershell';
        if (sName.includes('cmd')) return 'cmd';
        if (sName.includes('bash')) return 'bash';
        if (sName.includes('zsh')) return 'zsh';
        if (sName.includes('fish')) return 'fish';
        if (sName.includes('wsl')) return 'wsl';
        return sName.replace(/\.exe$/, '');
      }
    }
  } catch (_) {
    // Intentionally ignored
  }
  return guessShellFromEnv();
}

function guessShellFromEnv() {
  var platform = process.platform;
  if (platform === 'win32') {
    try {
      if (process.env.PSModulePath) return 'powershell';
    } catch (_) {
      // Intentionally ignored
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
      // Intentionally ignored
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

export function getShellName(sessionId) {
  var term = null;
  if (sessionId && _sessions[sessionId]) {
    term = _sessions[sessionId].terminal;
  }
  return detectShellName(term);
}

export function getPlatformName() {
  return getPlatform();
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

export function setSendEventCallback(callback, sessionId) {
  var sess = getSession(sessionId);
  sess.sendEventCallback = callback;
}

var INTERACTIVE_PATTERNS = [
  /\(y\/n\)/i,
  /\[y\/n\]/i,
  /\[Y\/n\]/i,
  /\[y\/N\]/i,
  /are you sure/i,
  /continue\?/i,
  /press any key/i,
  /press enter/i,
  /password\s*:/i,
  /passphrase\s*:/i,
  /token\s*:/i,
  /select an option/i,
  /choice\s*:/i,
  /choose\s*\[/i,
  /\? \[.*\]/,
  /(?:enter|input|type)\s+(?:a|an|the|your)?\s*[\w\s]{1,30}\s*:/i
];

function detectPrompt(output) {
  if (!output) return { interactive: false, promptDetected: false };
  var lastLines = output.split('\n').slice(-3).join('\n');
  for (var i = 0; i < INTERACTIVE_PATTERNS.length; i++) {
    var pat = INTERACTIVE_PATTERNS[i];
    if (pat.test(lastLines)) {
      return { interactive: true, promptDetected: true };
    }
  }
  return { interactive: false, promptDetected: false };
}

export function getTerminal(sessionId, workspace) {
  var sess = getSession(sessionId);
  if (sess.terminal) {
    return sess.terminal;
  }

  var termName = 'CodeRun (' + (sessionId || 'default') + ')';
  var allTerms = vscode.window.terminals || [];
  for (var i = 0; i < allTerms.length; i++) {
    if (allTerms[i].name === termName) {
      sess.terminal = allTerms[i];
      return sess.terminal;
    }
  }

  var cwd = workspace || undefined;
  if (!cwd && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
  }

  var termOptions = {
    name: termName,
    cwd: cwd
  };

  if (vscode.TerminalLocation && vscode.TerminalLocation.Panel) {
    termOptions.location = vscode.TerminalLocation.Panel;
  }

  sess.terminal = vscode.window.createTerminal(termOptions);

  function onTerminalClosed(closedTerm) {
    if (closedTerm === sess.terminal) {
      sess.terminal = null;
      sess.lastSessionActive = false;
      sess.activeExecId = null;
    }
  }

  terminalListeners.push(vscode.window.onDidCloseTerminal(onTerminalClosed));
  return sess.terminal;
}

// ── Interactive command check ───────────────────────────────
var INTERACTIVE_COMMANDS = [
  'ssh', 'sftp', 'ftp', 'telnet',
  'python -i', 'python3 -i', 'node -i', 'irb',
  'mysql', 'psql', 'sqlite3', 'mongo', 'mongosh', 'redis-cli',
  'nano', 'vim', 'vi', 'emacs', 'less', 'more',
  'top', 'htop', 'glances',
  'powershell -noexit', 'cmd /k'
];

function checkInteractiveCommand(command) {
  var trimmed = (command || '').trim().toLowerCase();
  if (!trimmed) return false;
  var segments = trimmed.split(/[|;&]+/);
  for (var s = 0; s < segments.length; s++) {
    var seg = segments[s].trim();
    if (!seg) continue;
    var words = seg.split(/\s+/);
    var exe = words[0];
    var exeWithArg = words.length > 1 ? (words[0] + ' ' + words[1]) : '';
    for (var i = 0; i < INTERACTIVE_COMMANDS.length; i++) {
      var ic = INTERACTIVE_COMMANDS[i];
      if (exe === ic || exeWithArg === ic || seg === ic || seg.startsWith(ic + ' ')) {
        return true;
      }
    }
  }
  return false;
}

function createExecFilePromise(shellExe, fullArgs, cwd, timeout, sess) {
  function executeFilePromise(resolve) {
    var options = {
      cwd: cwd || undefined,
      timeout: (timeout || 30) * 1000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true
    };
    function onResult(error, cpStdout, cpStderr) {
      if (sess && sess.activeChildProcess === childProc) {
        sess.activeChildProcess = null;
      }
      if (error) {
        resolve({
          stdout: cpStdout || '',
          stderr: cpStderr || (error.killed ? 'Command timed out after ' + timeout + 's' : error.message),
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
    var childProc = execFile(shellExe, fullArgs, options, onResult);
    if (sess) {
      sess.activeChildProcess = childProc;
    }
  }
  return new Promise(executeFilePromise);
}

function waitForShellIntegration(terminal, timeoutMs) {
  if (!terminal) return Promise.resolve(null);
  if (terminal.shellIntegration) {
    return Promise.resolve(terminal.shellIntegration);
  }
  timeoutMs = timeoutMs || 1200;
  var disposable = null;

  function executor(resolve) {
    var timer = setTimeout(function onTimeout() {
      if (disposable) disposable.dispose();
      resolve(terminal.shellIntegration || null);
    }, timeoutMs);

    function onIntegrationChange(event) {
      if (event && event.terminal === terminal && event.shellIntegration) {
        clearTimeout(timer);
        if (disposable) disposable.dispose();
        resolve(event.shellIntegration);
      }
    }

    if (vscode.window && typeof vscode.window.onDidChangeTerminalShellIntegration === 'function') {
      disposable = vscode.window.onDidChangeTerminalShellIntegration(onIntegrationChange);
    } else {
      clearTimeout(timer);
      resolve(null);
    }
  }

  return new Promise(executor);
}

export async function executeCommand(command, timeout, background, isInteractive, sessionId, workspace) {
  timeout = timeout || 30;
  var sess = getSession(sessionId);
  var terminal = getTerminal(sessionId, workspace);
  terminal.show(true);

  var cwd = workspace || undefined;
  if (!cwd && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
  }

  var shellName = detectShellName(terminal);
  var platformName = getPlatform();
  var startedAt = Date.now();
  var sendEvent = sess.sendEventCallback;

  // Background execution: Track explicit task handle and lifecycle
  if (background) {
    var bgExecId = 'term_bg_' + (++executionCounter);
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

    var fullArgs = shellArg.split(' ').concat([command]);
    var bgProcess = null;
    try {
      var spawnOptions = {
        cwd: cwd || undefined,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      };
      function onBgExit(error) {
        var t = sess.backgroundTasks[bgExecId];
        if (t && t.status !== 'cancelled') {
          t.status = error ? 'failed' : 'completed';
          t.exitCode = error ? (error.code != null ? error.code : 1) : 0;
          t.endedAt = Date.now();
          if (sendEvent) {
            sendEvent({
              type: 'terminal_exit',
              terminalId: bgExecId,
              exitCode: t.exitCode,
              duration: Date.now() - startedAt,
              shell: shellName,
              platform: platformName,
              cwd: cwd,
              command: command,
              background: true
            });
          }
        }
      }
      bgProcess = execFile(shellExe, fullArgs, spawnOptions, onBgExit);
    } catch (_) {
      terminal.sendText(command, true);
    }

    sess.backgroundTasks[bgExecId] = {
      id: bgExecId,
      command: command,
      status: bgProcess ? 'running' : 'submitted_to_terminal',
      startedAt: startedAt,
      childProcess: bgProcess
    };

    if (sendEvent) {
      sendEvent({
        type: 'terminal_start',
        terminalId: bgExecId,
        command: command,
        shell: shellName,
        platform: platformName,
        cwd: cwd,
        background: true
      });
    }

    return {
      shell: shellName,
      platform: platformName,
      command: command,
      taskId: bgExecId,
      stdout: '',
      stderr: '',
      exitCode: null,
      durationMs: Date.now() - startedAt,
      success: true,
      workingDirectory: cwd,
      background: true,
      status: bgProcess ? 'running' : 'submitted_to_terminal'
    };
  }

  // 1. Try Shell Integration execution (wait briefly for integration if terminal was just created)
  var shellIntegration = terminal.shellIntegration;
  if (!shellIntegration && typeof vscode.window.onDidChangeTerminalShellIntegration === 'function') {
    try {
      shellIntegration = await waitForShellIntegration(terminal, 1200);
    } catch (_) {}
  }

  if (shellIntegration) {
    var shellExecutionStarted = false;
    var execId = 'term_exec_' + (++executionCounter);
    var stdout = '';
    var stderr = '';
    var timeoutTimer = null;
    var isTimedOut = false;

    try {
      console.log('[TERMINAL] Executing command via Shell Integration for session', sess.id, ':', command);
      sess.activeExecId = execId;
      var execution = shellIntegration.executeCommand(command);
      shellExecutionStarted = true;
      var stream = execution.read();

      if (sendEvent) {
        sendEvent({
          type: 'terminal_start',
          terminalId: execId,
          command: command,
          shell: shellName,
          platform: platformName,
          cwd: cwd
        });
      }

      var timeoutMs = timeout * 1000;

      function createStreamTimeoutPromise() {
        function executor(resolve, reject) {
          timeoutTimer = setTimeout(async function onStreamTimeout() {
            isTimedOut = true;
            console.warn('[TERMINAL] Shell integration command timed out after ' + timeout + 's. Interrupting process in terminal for session:', sess.id);
            try {
              await stopTerminal(sess.id);
            } catch (_) {}
            reject(new Error('Shell integration execution timed out after ' + timeout + 's (process cancelled)'));
          }, timeoutMs);
        }
        return new Promise(executor);
      }

      var isWaitingForPrompt = false;
      var promptSilenceTimer = null;

      function checkPromptSilence(resolveStream) {
        if (promptSilenceTimer) {
          clearTimeout(promptSilenceTimer);
        }
        var pCheck = detectPrompt(stdout);
        var isRealPrompt = pCheck.interactive || checkInteractiveCommand(command);
        if (isRealPrompt) {
          promptSilenceTimer = setTimeout(function onPromptDetected() {
            isWaitingForPrompt = true;
            sess.lastSessionActive = true;
            resolveStream(0);
          }, 300);
        }
      }

      function consumeStream() {
        function streamExecutor(resolve) {
          async function readLoop() {
            try {
              for await (var chunk of stream) {
                var cleanChunk = stripAnsi(String(chunk));
                if (cleanChunk) {
                  stdout += cleanChunk;
                  sess.lastSessionOutput += cleanChunk;
                  if (sendEvent) {
                    sendEvent({
                      type: 'terminal_output',
                      terminalId: execId,
                      chunk: cleanChunk
                    });
                  }
                  checkPromptSilence(resolve);
                }
              }
              if (promptSilenceTimer) {
                clearTimeout(promptSilenceTimer);
              }
              var code = 0;
              if (execution) {
                if (typeof execution.exitCode === 'number') {
                  code = execution.exitCode;
                } else if (execution.exitCode && typeof execution.exitCode.then === 'function') {
                  try {
                    var resCode = await execution.exitCode;
                    if (typeof resCode === 'number') code = resCode;
                  } catch (_) {}
                }
              }
              resolve(typeof code === 'number' ? code : 0);
            } catch (err) {
              if (promptSilenceTimer) {
                clearTimeout(promptSilenceTimer);
              }
              resolve(0);
            }
          }
          readLoop();
        }
        return new Promise(streamExecutor);
      }

      var exitCode = 0;
      try {
        exitCode = await Promise.race([consumeStream(), createStreamTimeoutPromise()]);
      } finally {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        if (promptSilenceTimer) {
          clearTimeout(promptSilenceTimer);
          promptSilenceTimer = null;
        }
      }

      var durationMs = Date.now() - startedAt;
      sess.activeExecId = null;

      if (sendEvent) {
        sendEvent({
          type: 'terminal_exit',
          terminalId: execId,
          exitCode: isWaitingForPrompt ? null : exitCode,
          duration: durationMs,
          shell: shellName,
          platform: platformName,
          cwd: cwd,
          command: command
        });
      }

      var promptCheck = detectPrompt(stdout);
      var isSuccess = !isTimedOut && (exitCode === 0 || exitCode == null);
      var finalStatus = isWaitingForPrompt ? 'waiting_for_input' : (isSuccess ? 'completed' : 'failed');

      return {
        shell: shellName,
        platform: platformName,
        command: command,
        stdout: stdout,
        stderr: stderr,
        exitCode: isWaitingForPrompt ? null : exitCode,
        durationMs: durationMs,
        success: isSuccess,
        workingDirectory: cwd,
        method: 'shell_integration',
        interactive: promptCheck.interactive || isWaitingForPrompt,
        promptDetected: promptCheck.promptDetected || isWaitingForPrompt,
        waitingForInput: isWaitingForPrompt,
        status: finalStatus
      };
    } catch (siErr) {
      console.warn('[TERMINAL] Shell integration execution error:', siErr.message);
      sess.activeExecId = null;

      // If execution was already started on the shell, handle timeout / stream error cleanly
      if (shellExecutionStarted) {
        var failDurationMs = Date.now() - startedAt;
        if (sendEvent) {
          sendEvent({
            type: 'terminal_error',
            terminalId: execId,
            message: siErr.message,
            shell: shellName,
            platform: platformName
          });
        }

        // Check if execution actually exited with a valid code despite stream reading issue
        var fallbackExitCode = isTimedOut ? -1 : (typeof execution.exitCode === 'number' ? execution.exitCode : -1);
        var isRealSuccess = fallbackExitCode === 0;

        return {
          shell: shellName,
          platform: platformName,
          command: command,
          stdout: stdout,
          stderr: siErr.message,
          exitCode: fallbackExitCode,
          durationMs: failDurationMs,
          success: isRealSuccess,
          workingDirectory: cwd,
          method: 'shell_integration',
          error: siErr.message,
          status: isTimedOut ? 'timed_out' : (isRealSuccess ? 'completed' : 'failed'),
          observationError: !isTimedOut && !isRealSuccess
        };
      }
    }
  }

  // 2. Child Process Fallback (Executes strictly ONCE only if Shell Integration was not started)
  console.log('[TERMINAL] Using isolated child_process fallback for session', sess.id, ':', command);

  // If interactive, send to VS Code terminal directly without child_process duplicate
  if (checkInteractiveCommand(command) || isInteractive) {
    terminal.sendText(command, true);
    var interactiveExecId = 'term_interactive_' + (++executionCounter);
    if (sendEvent) {
      sendEvent({
        type: 'terminal_start',
        terminalId: interactiveExecId,
        command: command,
        shell: shellName,
        platform: platformName,
        cwd: cwd,
        interactive: true
      });
    }
    return {
      shell: shellName,
      platform: platformName,
      command: command,
      stdout: 'Interactive command running in VS Code terminal.',
      stderr: '',
      exitCode: null,
      durationMs: Date.now() - startedAt,
      success: true,
      workingDirectory: cwd,
      interactive: true,
      status: 'running',
      submitted: true,
      message: 'Interactive command submitted to VS Code terminal.'
    };
  }

  // Non-interactive: Execute strictly via execFile
  var fallbackExecId = 'term_fallback_' + (++executionCounter);
  sess.activeExecId = fallbackExecId;
  if (sendEvent) {
    sendEvent({
      type: 'terminal_start',
      terminalId: fallbackExecId,
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
    var fullArgs = shellArg.split(' ').concat([command]);
    var cpResult = await createExecFilePromise(shellExe, fullArgs, cwd, timeout, sess);

    var fbStdout = stripAnsi(cpResult.stdout || '');
    var fbStderr = stripAnsi(cpResult.stderr || '');
    var fbExitCode = cpResult.exitCode;
    var fbDurationMs = Date.now() - startedAt;

    sess.lastSessionOutput += fbStdout;

    if (sendEvent && fbStdout) {
      sendEvent({ type: 'terminal_output', terminalId: fallbackExecId, chunk: fbStdout });
    }
    if (sendEvent && fbStderr) {
      sendEvent({ type: 'terminal_output', terminalId: fallbackExecId, chunk: fbStderr });
    }
    if (sendEvent) {
      sendEvent({
        type: 'terminal_exit',
        terminalId: fallbackExecId,
        exitCode: fbExitCode,
        duration: fbDurationMs,
        shell: shellName,
        platform: platformName,
        cwd: cwd,
        command: command,
        fallback: true
      });
    }

    sess.activeExecId = null;
    return {
      shell: shellName,
      platform: platformName,
      command: command,
      stdout: fbStdout,
      stderr: fbStderr,
      exitCode: fbExitCode,
      durationMs: fbDurationMs,
      success: fbExitCode === 0,
      workingDirectory: cwd,
      method: 'execFile_fallback',
      status: fbExitCode === 0 ? 'completed' : 'failed'
    };
  } catch (cpErr) {
    sess.activeExecId = null;
    var errDuration = Date.now() - startedAt;
    if (sendEvent) {
      sendEvent({
        type: 'terminal_error',
        terminalId: fallbackExecId,
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
      durationMs: errDuration,
      success: false,
      workingDirectory: cwd,
      method: 'execFile_fallback',
      error: cpErr.message
    };
  }
}

export async function sendTerminalInput(text, sessionId) {
  var sess = getSession(sessionId);
  var term = getTerminal(sessionId);
  term.show(true);
  var cleanText = String(text != null ? text : '');
  term.sendText(cleanText, true);

  // Allow shell to process input and emit response into stream buffer
  function waitTimer(resolve) {
    setTimeout(resolve, 300);
  }
  await new Promise(waitTimer);

  var fullOutput = sess.lastSessionOutput || '';
  var responseOutput = fullOutput.substring(sess.lastCheckedPosition);
  sess.lastCheckedPosition = fullOutput.length;

  var pCheck = detectPrompt(responseOutput);
  if (!pCheck.interactive) {
    sess.lastSessionActive = false;
  }

  return {
    success: true,
    status: pCheck.interactive ? 'waiting_for_input' : 'sent',
    stdout: responseOutput,
    output: responseOutput,
    interactive: pCheck.interactive,
    message: 'Input sent to terminal: ' + cleanText + (responseOutput ? ('\nResponse output:\n' + responseOutput) : '')
  };
}

export async function checkTerminalOutput(sessionId) {
  var sess = getSession(sessionId);

  // Allow in-flight stream chunks to settle into buffer
  function waitTick(resolve) {
    setTimeout(resolve, 250);
  }
  await new Promise(waitTick);

  var fullOutput = sess.lastSessionOutput || '';
  var shellName = sess.terminal ? detectShellName(sess.terminal) : 'unknown';
  var platformName = getPlatform();

  var newOutput = fullOutput.substring(sess.lastCheckedPosition);
  sess.lastCheckedPosition = fullOutput.length;

  var isWaiting = sess.lastSessionActive;
  var hasRunningBackground = false;
  for (var bKey in sess.backgroundTasks) {
    if (sess.backgroundTasks[bKey] && sess.backgroundTasks[bKey].status === 'running') {
      hasRunningBackground = true;
      break;
    }
  }
  var hasActiveExecution = !!sess.activeExecId || !!sess.activeChildProcess || hasRunningBackground;
  var promptCheck = detectPrompt(newOutput);
  var currentStatus = (isWaiting || promptCheck.interactive) ? 'waiting_for_input' : (hasActiveExecution ? 'active' : 'completed');
  return {
    shell: shellName,
    platform: platformName,
    stdout: newOutput,
    stderr: '',
    exitCode: null,
    durationMs: 0,
    success: true,
    status: currentStatus,
    waitingForInput: isWaiting || promptCheck.interactive,
    interactive: promptCheck.interactive,
    promptDetected: promptCheck.promptDetected
  };
}

export async function stopTerminal(sessionId) {
  var sess = getSession(sessionId);

  var hadActiveProcess = false;

  // 1. Stop active fallback child process if running
  if (sess.activeChildProcess) {
    console.log('[TERMINAL] Stopping active child process for session', sess.id);
    killChildProcess(sess.activeChildProcess);
    sess.activeChildProcess = null;
    hadActiveProcess = true;
  }

  // 2. Stop any running background tasks
  for (var bgId in sess.backgroundTasks) {
    var bgTask = sess.backgroundTasks[bgId];
    if (bgTask && bgTask.status === 'running') {
      if (bgTask.childProcess) {
        killChildProcess(bgTask.childProcess);
        bgTask.childProcess = null;
      }
      bgTask.status = 'cancelled';
      hadActiveProcess = true;
    }
  }

  // 3. Send Ctrl+C interrupt directly to this session's VS Code terminal if active
  if (sess.lastSessionActive || sess.activeExecId || hadActiveProcess) {
    hadActiveProcess = true;
    var term = getTerminal(sessionId);
    if (term) {
      try {
        term.show(true);
        term.sendText('\u0003', false);
      } catch (_) {}
    }

    console.log('[TERMINAL] Sent Ctrl+C interrupt to session terminal:', sess.id);

    if (sess.sendEventCallback) {
      sess.sendEventCallback({
        type: 'terminal_output',
        terminalId: sess.activeExecId || ('term_stop_' + Date.now()),
        chunk: '^C\n'
      });
    }

    sess.lastSessionActive = false;
    sess.activeExecId = null;
    sess.pendingInteractiveReader = null;
    sess.pendingInteractiveExecution = null;
    sess.lastCheckedPosition = (sess.lastSessionOutput || '').length;

    return { success: true, status: 'stopped', message: 'Sent Ctrl+C to stop running process.' };
  }

  return { success: false, status: 'not_running', message: 'No active command or process was running in terminal.' };
}

export function resetTerminal(sessionId) {
  var sess = getSession(sessionId);
  if (sess.activeChildProcess) {
    killChildProcess(sess.activeChildProcess);
    sess.activeChildProcess = null;
  }
  if (sess.terminal) {
    try {
      sess.terminal.dispose();
    } catch (_) {
      // Intentionally ignored
    }
    sess.terminal = null;
  }
  sess.lastSessionOutput = '';
  sess.lastSessionActive = false;
  sess.lastCheckedPosition = 0;
  sess.backgroundTasks = {};
}

export function getBackgroundTaskStatus(taskId, sessionId) {
  var sess = getSession(sessionId);
  return sess.backgroundTasks[taskId] || null;
}

export async function stopBackgroundTask(taskId, sessionId) {
  var sess = getSession(sessionId);
  var task = sess.backgroundTasks[taskId];
  if (!task) {
    return { success: false, message: 'Background task not found: ' + taskId };
  }
  if (task.childProcess) {
    killChildProcess(task.childProcess);
    task.childProcess = null;
    task.status = 'cancelled';
    return { success: true, message: 'Background task ' + taskId + ' cancelled.' };
  }
  task.status = 'cancel_requested';
  if (sess.terminal) {
    try {
      sess.terminal.sendText('\u0003', false);
    } catch (_) {}
  }
  return { success: true, message: 'Background task ' + taskId + ' cancellation requested.' };
}

export function onTerminalClosed(terminal) {
  if (!terminal) return;
  for (var sid in _sessions) {
    var sess = _sessions[sid];
    if (sess && sess.terminal === terminal) {
      console.log('[TERMINAL] Terminal closed for session:', sid);
      sess.terminal = null;
      sess.lastSessionActive = false;
      sess.activeExecId = null;
      sess.pendingInteractiveReader = null;
      sess.pendingInteractiveExecution = null;
    }
  }
}

export function registerTerminalListeners(context) {
  if (!vscode.window) return;
  if (vscode.window.onDidStartTerminalShellExecution) {
    try {
      function onShellStart(e) {
        if (e && e.terminal) {
          console.log('[TERMINAL] Shell execution started for terminal:', e.terminal.name);
        }
      }
      var startListener = vscode.window.onDidStartTerminalShellExecution(onShellStart);
      terminalListeners.push(startListener);
      if (context && context.subscriptions) {
        context.subscriptions.push(startListener);
      }
    } catch (_) {
      // Intentionally ignored
    }
  }

  if (vscode.window.onDidEndTerminalShellExecution) {
    try {
      function onShellEnd(e) {
        if (e && e.terminal) {
          console.log('[TERMINAL] Shell execution ended for terminal:', e.terminal.name);
        }
      }
      var endListener = vscode.window.onDidEndTerminalShellExecution(onShellEnd);
      terminalListeners.push(endListener);
      if (context && context.subscriptions) {
        context.subscriptions.push(endListener);
      }
    } catch (_) {
      // Intentionally ignored
    }
  }

  if (vscode.window.onDidCloseTerminal) {
    try {
      function onTermClose(term) {
        onTerminalClosed(term);
      }
      var closeListener = vscode.window.onDidCloseTerminal(onTermClose);
      terminalListeners.push(closeListener);
      if (context && context.subscriptions) {
        context.subscriptions.push(closeListener);
      }
    } catch (_) {
      // Intentionally ignored
    }
  }
}

export function disposeSession(sessionId) {
  removeSession(sessionId);
}

export function dispose() {
  for (var i = 0; i < terminalListeners.length; i++) {
    try {
      terminalListeners[i].dispose();
    } catch (_) {
      // Intentionally ignored
    }
  }
  terminalListeners = [];
  for (var sid in _sessions) {
    removeSession(sid);
  }
}
