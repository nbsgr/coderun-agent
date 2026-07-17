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

// ── Shell detection ────────────────────────────────────────
// Auto-detect the shell name from VS Code's terminal API.
function detectShellName(terminal) {
  if (!terminal) return guessShellFromEnv();
  // VS Code exposes shell path via creationOptions if available
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
  } catch (_) {}
  return guessShellFromEnv();
}

function guessShellFromEnv() {
  var platform = process.platform;
  if (platform === 'win32') {
    // Check for common Windows shells
    if (process.env.SHELL) {
      var sh = path.basename(process.env.SHELL).toLowerCase();
      if (sh.includes('bash')) return 'bash (Git Bash)';
      if (sh.includes('zsh')) return 'zsh';
    }
    // Detect PowerShell vs cmd via parent process
    try {
      var comspec = process.env.COMSPEC || '';
      if (comspec.toLowerCase().includes('cmd')) return 'cmd';
    } catch (_) {}
    // Default: check if PowerShell is available
    try {
      if (process.env.PSModulePath) return 'powershell';
    } catch (_) {}
    return 'powershell';
  }
  if (platform === 'darwin') {
    return process.env.SHELL ? path.basename(process.env.SHELL) : 'zsh';
  }
  // Linux / WSL
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
// Removes all ANSI escape sequences, OSC sequences, shell integration
// markers, cursor control sequences, and color codes.
function stripAnsi(text) {
  if (!text) return '';
  var cleaned = text
    // Remove OSC sequences like ]633;C ]633;D ]0;... ]1;... etc.
    .replace(/\x1B\]\d+(?:;[^\x1B]*)*(?:\x1B\\)/g, '')
    // Remove standard ANSI escape sequences (colors, cursor movement, etc.)
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
    // Remove remaining OSC sequences without ST
    .replace(/\x1B\][^\x1B]*[\x07\x1B]/g, '')
    // Remove orphan BEL characters from OSC
    .replace(/\x07/g, '')
    // Remove VT100 window title sequences
    .replace(/\x1B[\x5D\x5B][^\x1B]*[\x07\x5C]/g, '')
    // Remove any remaining escape sequences (sweep)
    .replace(/\x1B[\[\]()][0-9;]*[~A-Za-z]/g, '')
    .replace(/\x1B[\[\]()]/g, '')
    .replace(/\x1B[^\[\]()\s]/g, '')
    // Remove VS Code shell integration markers specifically
    .replace(/\]633;/g, '')
    .replace(/\]133;/g, '')
    .replace(/\]633;d;([^\x07\x1B]+)/g, '')
    // Normalize CRLF -> LF
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  return cleaned;
}

/**
 * Set the callback used to forward terminal events to the webview.
 * Called by extension.js when a chat starts.
 */
export function setSendEventCallback(callback) {
  sendEventCallback = callback;
}

/**
 * Get the detected shell name.
 * Public wrapper so tools.js and ChatSpace can access it.
 */
export function getShellName() {
  var term = getTerminal();
  return detectShellName(term);
}

/**
 * Get platform identifier.
 */
export function getPlatformName() {
  return getPlatform();
}

/**
 * Get or create the CodeRun terminal. Reuses existing terminal.
 */
export function getTerminal() {
  if (activeTerminal && !activeTerminal.exitStatus) {
    return activeTerminal;
  }
  // Try to find an existing CodeRun terminal
  var existing = vscode.window.terminals.find(function(t) {
    return t.name === 'CodeRun Agent';
  });
  if (existing && !existing.exitStatus) {
    activeTerminal = existing;
    return activeTerminal;
  }
  // Create new terminal
  var workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
  activeTerminal = vscode.window.createTerminal({
    name: 'CodeRun Agent',
    cwd: workspaceFolder,
    location: vscode.TerminalLocation.Panel
  });
  return activeTerminal;
}

/**
 * Wait up to `ms` milliseconds for shell integration to become available
 * on the active terminal. Fresh terminals take a moment to initialize it.
 */
export async function waitForShellIntegration(ms) {
  ms = ms || 5000;
  if (!activeTerminal) return false;
  if (activeTerminal.shellIntegration) return true;
  return new Promise(function(resolve) {
    var disposable = vscode.window.onDidChangeTerminalShellIntegration(function(event) {
      if (event.terminal === activeTerminal && event.shellIntegration) {
        disposable.dispose();
        resolve(true);
      }
    });
    setTimeout(function() {
      disposable.dispose();
      resolve(!!activeTerminal.shellIntegration);
    }, ms);
  });
}

/**
 * Register global terminal shell integration listeners.
 * Call once from extension activate().
 */
export function registerTerminalListeners(context) {
  if (!vscode.window.onDidChangeTerminalShellIntegration) {
    console.log('[TERMINAL] Shell integration change events are not available in this VS Code version.');
    return;
  }

  // Listen for shell integration becoming available on terminals
  var changeSub = vscode.window.onDidChangeTerminalShellIntegration(function(event) {
    var terminal = event.terminal;
    var shellIntegration = event.shellIntegration;
    console.log('[TERMINAL] Shell integration changed for:', terminal.name);
    // If this is our active terminal and it now has shell integration,
    // we can execute commands via executeCommand
    if (terminal === activeTerminal && shellIntegration) {
      console.log('[TERMINAL] Shell integration ready for CodeRun terminal');
    }
  });
  terminalListeners.push(changeSub);
  context.subscriptions.push(changeSub);

  // Listen for terminal close
  var closeSub = vscode.window.onDidCloseTerminal(function(terminal) {
    if (terminal === activeTerminal) {
      activeTerminal = null;
      // Notify about any pending executions
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
  });
  terminalListeners.push(closeSub);
  context.subscriptions.push(closeSub);
}

/**
 * Read output stream from a TerminalShellExecution.
 */
async function readExecutionStream(execId, execution) {
  try {
    var stream = execution.read();
    for await (var chunk of stream) {
      if (!pendingExecutions[execId]) break;
      pendingExecutions[execId].output += chunk;
      if (sendEventCallback) {
        sendEventCallback({
          type: 'terminal_output',
          terminalId: execId,
          chunk: chunk
        });
      }
    }
  } catch (err) {
    console.error('[TERMINAL] Error reading execution stream:', err);
    if (sendEventCallback && pendingExecutions[execId]) {
      sendEventCallback({
        type: 'terminal_error',
        terminalId: execId,
        message: err.message
      });
    }
  }
}

// ── Interactive prompt detection ────────────────────────────
// Heuristic: scan text for common interactive patterns.
// Returns { interactive: bool, promptDetected: bool }.
function detectPrompt(text) {
  if (!text) return { interactive: false, promptDetected: false };
  var lines = text.split('\n');
  var interactive = false;
  var promptDetected = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();

    // Radio/checkbox menu characters (npm create vite, etc.)
    if (/[○●◉◎⦿⊙⊚]/.test(line)) {
      interactive = true;
      promptDetected = true;
    }

    // Arrow key navigation hints (↑/↓)
    if (/[↑↓←→]/.test(line)) {
      interactive = true;
      promptDetected = true;
    }

    // Lines that end with colon — typical prompt form (e.g. "Select framework:")
    if (/[:：]\s*$/.test(line) && line.length < 120) {
      interactive = true;
      promptDetected = true;
    }

    // (y/N) (Y/n) (Y/N) [y/N] patterns
    if (/\([yYnN]\/[yYnN]\)|\[[yYnN]\/[yYnN]\]/.test(line)) {
      interactive = true;
      promptDetected = true;
    }

    // Bracketed choice: [1] [2] [3] or (1) (2) (3)
    if (/\[ ?\d+ ?\]|\( ?\d+ ?\)/.test(line) && lines.length - i < 30) {
      interactive = true;
    }

    // "Select", "Choose", "Pick" at line start
    if (/^(Select|Choose|Pick)\b/i.test(line)) {
      interactive = true;
      promptDetected = true;
    }

    // Line ends with "?" — direct question prompt
    if (/\?\s*$/.test(line) && line.length < 150) {
      interactive = true;
      promptDetected = true;
    }
  }

  return { interactive: interactive, promptDetected: promptDetected };
}

/**
 * Execute a command in the VS Code terminal using shell integration.
 * Falls back to sendText if shell integration is not available.
 * Returns a promise that resolves when the command completes.
 */
export async function executeCommand(command, timeout, background) {
  timeout = timeout || 30;
  var terminal = getTerminal();
  terminal.show(true);

  var shellName = detectShellName(terminal);
  var platformName = getPlatform();
  var cwd = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || '';
  var startedAt = Date.now();

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
      setTimeout(function() {
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
      }, 1000);
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
    // Fresh terminals need time for shell integration to initialize
    await waitForShellIntegration(3000);
    shellIntegration = terminal.shellIntegration;
  }

  if (shellIntegration) {
    // Use shell integration executeCommand for reliable tracking
    console.log('[TERMINAL] Executing via shell integration:', command);
    try {
      var execId = 'term_direct_' + (++executionCounter);
      var execution = shellIntegration.executeCommand(command);
      var stdout = '';
      var stderr = '';
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
      // Verify read() returns an async iterable (not a raw stream)
      var iterable = execution.read();
      if (!iterable || typeof iterable[Symbol.asyncIterator] !== 'function') {
        throw new Error('Shell integration read() did not return an async iterable.');
      }

      console.log('[TERMINAL] Entering for-await loop for', execId);
      var reader = iterable[Symbol.asyncIterator]();
      var chunkCount = 0;
      var idleDetected = false;

      try {
        var IDLE_TIMEOUT_MS = 3000;

        while (true) {
          // Race between next chunk from the process and an idle timeout.
          // If no output arrives within IDLE_TIMEOUT_MS, the process is
          // likely waiting for stdin (interactive prompt).
          var nextPromise = reader.next();
          var timeoutId = null;
          var raceResult = await Promise.race([
            nextPromise.then(function(r) {
              if (timeoutId) clearTimeout(timeoutId);
              timeoutId = null;
              return r;
            }),
            new Promise(function(resolve) {
              timeoutId = setTimeout(function() {
                resolve({ done: true, value: undefined, _idleTimeout: true });
              }, IDLE_TIMEOUT_MS);
            })
          ]);

          // If idle timeout fired, the process is waiting for input
          if (raceResult._idleTimeout) {
            idleDetected = true;
            break;
          }

          // Stream ended normally (process exited)
          if (raceResult.done) break;

          var chunk = raceResult.value;
          chunkCount++;
          console.log('[TERMINAL] Chunk #' + chunkCount + ' for', execId, 'length:', String(chunk || '').length);
          var text = String(chunk || '');
          // Strip ANSI sequences before accumulation and forwarding
          var cleanChunk = stripAnsi(text);
          stdout += cleanChunk;
          if (sendEventCallback && cleanChunk) {
            sendEventCallback({
              type: 'terminal_output',
              terminalId: execId,
              chunk: cleanChunk
            });
          }

          // Total wall-clock timeout check (in case process runs forever)
          if (Date.now() > timeoutAt) {
            throw new Error('Command timed out after ' + timeout + ' seconds.');
          }
        }
        // Share the accumulated stdout for checkTerminalOutput
        _lastSessionOutput = stdout;
        _lastSessionActive = (idleDetected === true);
      } catch (streamErr) {
        console.log('[TERMINAL] for-await loop threw for', execId, ':', streamErr.message, 'chunks received:', chunkCount);
        throw streamErr;
      }

      if (idleDetected) {
        // Process is still running, waiting for input — don't await exitCode
        // (it would hang forever since the process hasn't exited).
        console.log('[TERMINAL] Idle timeout for', execId, '- process waiting for input');
        var durationMs2 = Date.now() - startedAt;
        // Analyze output for interactive prompt patterns
        var promptCheck = detectPrompt(stdout);
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
      return {
        shell: shellName,
        platform: platformName,
        command: command,
        stdout: stdout,
        stderr: stderr,
        exitCode: exitCode,
        durationMs: durationMs,
        success: exitCode === 0,
        workingDirectory: cwd,
        method: 'shell_integration',
        interactive: promptCheck.interactive,
        promptDetected: promptCheck.promptDetected,
        status: exitCode != null ? (exitCode === 0 ? 'completed' : 'failed') : 'completed'
      };
    } catch (err) {
      console.error('[TERMINAL] Shell integration executeCommand failed:', err);
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
      // Fall through to fallback
    }
  }

  // Fallback: shell integration unavailable — use child_process to
  // execute the command directly and capture real stdout/stderr/exitCode.
  // The command is ALSO sent to the visible terminal for user visibility.
  console.log('[TERMINAL] Shell integration unavailable — using child_process fallback:', command);
  terminal.sendText(command, true);

  var execId = 'term_fallback_' + (++executionCounter);
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

  // Determine shell executable and argument syntax for direct execution
  var shellExe = '';
  var shellArg = '';
  var lowerShell = shellName.toLowerCase();

  if (lowerShell.includes('powershell') || lowerShell.includes('pwsh')) {
    // Try pwsh first, then powershell
    shellExe = process.env.PWSH_EXE || 'powershell.exe';
    shellArg = '-NoProfile -NonInteractive -Command';
  } else if (lowerShell.includes('cmd')) {
    shellExe = process.env.COMSPEC || 'cmd.exe';
    shellArg = '/c';
  } else if (lowerShell.includes('wsl')) {
    shellExe = 'wsl.exe';
    shellArg = '--';
  } else {
    // bash, zsh, fish, git bash
    shellExe = process.env.SHELL || 'bash';
    shellArg = '-c';
  }

  try {
    var stdout = '';
    var stderr = '';
    var cpExitCode = null;

    // Build the full command: shell + arg + quoted command
    var fullArgs = shellArg.split(' ').concat([command]);

    var cpResult = await new Promise(function(resolve, reject) {
      var child = execFile(shellExe, fullArgs, {
        cwd: cwd || undefined,
        timeout: (timeout || 30) * 1000,
        maxBuffer: 1024 * 1024, // 1MB
        windowsHide: true
      }, function(error, cpStdout, cpStderr) {
        if (error) {
          // error.code is the exit code for execFile
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
      });
    });

    stdout = cpResult.stdout;
    stderr = cpResult.stderr;
    cpExitCode = cpResult.exitCode;
    var durationMs = Date.now() - startedAt;

    // Clean ANSI from captured output
    stdout = stripAnsi(stdout);
    stderr = stripAnsi(stderr);

    // Stream captured output to the UI
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
    // Last resort: child_process also failed — return what we have
    console.error('[TERMINAL] child_process fallback also failed:', cpErr.message);
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

/**
 * Legacy executeCommand for direct terminal use (non-agent).
 */
export function executeCommandLegacy(command) {
  if (!command) return;
  var terminal = getTerminal();
  terminal.show(true);
  terminal.sendText(command, true);
}

/**
 * Write output text to the terminal (legacy).
 */
export function writeOutput(text, outputType) {
  if (!text) return;
  var terminal = getTerminal();
  terminal.show(true);
  var prefix = outputType === 'stderr' ? '[ERROR] ' : '[OUTPUT] ';
  text.split('\n').forEach(function(line) {
    if (line.trim()) {
      terminal.sendText('echo "' + prefix + line.replace(/"/g, '\"') + '"', true);
    }
  });
}

/**
 * Dispose all terminal resources.
 */
export function dispose() {
  terminalListeners.forEach(function(sub) {
    try { sub.dispose(); } catch (_) {}
  });
  terminalListeners = [];
  if (activeTerminal) {
    try { activeTerminal.dispose(); } catch (_) {}
    activeTerminal = null;
  }
  pendingExecutions = {};
  sendEventCallback = null;
}

/**
 * Called when a terminal is closed.
 */
export function onTerminalClosed(terminal) {
  if (terminal === activeTerminal) {
    activeTerminal = null;
  }
}

/**
 * Dispose the current terminal so a fresh one is created on next use.
 */
export function resetTerminal() {
  if (activeTerminal) {
    try { activeTerminal.dispose(); } catch (_) {}
    activeTerminal = null;
  }
  _lastSessionOutput = '';
  _lastSessionActive = false;
}

/**
 * Check if shell integration is available on the active terminal.
 */
export function hasShellIntegration() {
  return activeTerminal && activeTerminal.shellIntegration ? true : false;
}

/**
 * Send text input directly to the active terminal.
 */
export function sendTerminalInput(text) {
  var terminal = getTerminal();
  terminal.show(true);
  terminal.sendText(text, true); // send with newline so it submits the input

  if (sendEventCallback) {
    sendEventCallback({
      type: 'terminal_output',
      terminalId: 'term_input_' + Date.now(),
      chunk: text + '\n'
    });
  }
  return { success: true, message: 'Input sent to terminal: ' + text };
}

/**
 * Check current terminal output.
 * Returns the most recently captured stdout from the last shell integration
 * execution, plus prompt detection analysis.
 * Used by run_terminal with empty command for continuation after terminal_input.
 */
export async function checkTerminalOutput() {
  var stdout = _lastSessionOutput || '';
  var stderr = '';
  var shellName = activeTerminal ? detectShellName(activeTerminal) : 'unknown';
  var platformName = getPlatform();
  var startedAt = Date.now();

  // Check whether there's an active running execution
  var isWaiting = _lastSessionActive;
  var exitCode = null;

  var promptCheck = detectPrompt(stdout);
  return {
    shell: shellName,
    platform: platformName,
    stdout: stdout,
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

/**
 * Send Ctrl+C to the active terminal using VS Code's sequence command.
 */
export async function stopTerminal() {
  var terminal = getTerminal();
  terminal.show(true);

  console.log('[TERMINAL] Sending Ctrl+C interrupt');

  // VS Code built-in command to send sequence (Ctrl+C is \u0003)
  await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', { text: '\u0003' });

  if (sendEventCallback) {
    sendEventCallback({
      type: 'terminal_output',
      terminalId: 'term_stop_' + Date.now(),
      chunk: '^C\n'
    });
  }

  return { success: true, message: 'Sent Ctrl+C to stop running process.' };
}
