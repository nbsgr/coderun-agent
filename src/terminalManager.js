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

      for await (var chunk of execution.read()) {
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
        if (Date.now() > timeoutAt) {
          throw new Error('Command timed out after ' + timeout + ' seconds.');
        }
      }

      var exitCode = await execution.exitCode;
      var durationMs = Date.now() - startedAt;
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
        method: 'shell_integration'
      };
    } catch (err) {
      console.error('[TERMINAL] Shell integration executeCommand failed:', err);
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
      method: 'sendText'
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
