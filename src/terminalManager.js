// terminalManager.js — VS Code Terminal with Shell Integration
// Executes commands in the REAL VS Code Integrated Terminal and streams
// output live to the chat UI via shell integration events.

import * as vscode from 'vscode';

var activeTerminal = null;
var terminalListeners = [];
var pendingExecutions = {};
var executionCounter = 0;
var sendEventCallback = null;

/**
 * Set the callback used to forward terminal events to the webview.
 * Called by extension.js when a chat starts.
 */
export function setSendEventCallback(callback) {
  sendEventCallback = callback;
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

  if (background) {
    console.log('[TERMINAL] Running command in background:', command);
    terminal.sendText(command, true);

    var execId = 'term_bg_' + (++executionCounter);
    if (sendEventCallback) {
      sendEventCallback({
        type: 'terminal_start',
        terminalId: execId,
        command: command,
        background: true
      });
      setTimeout(function() {
        if (sendEventCallback) {
          sendEventCallback({
            type: 'terminal_exit',
            terminalId: execId,
            exitCode: null,
            background: true,
            message: 'Process started in the background.'
          });
        }
      }, 1000);
    }

    return {
      method: 'background',
      terminal: terminal,
      success: true,
      output: '',
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
      var output = '';
      var startedAt = Date.now();
      var timeoutAt = startedAt + timeout * 1000;

      if (sendEventCallback) {
        sendEventCallback({
          type: 'terminal_start',
          terminalId: execId,
          command: command
        });
      }

      if (!execution || typeof execution.read !== 'function') {
        throw new Error('Shell integration did not return a readable execution stream.');
      }

      for await (var chunk of execution.read()) {
        var text = String(chunk || '');
        output += text;
        if (sendEventCallback && text) {
          sendEventCallback({
            type: 'terminal_output',
            terminalId: execId,
            chunk: text
          });
        }
        if (Date.now() > timeoutAt) {
          throw new Error('Command timed out after ' + timeout + ' seconds.');
        }
      }

      var exitCode = await execution.exitCode;
      if (sendEventCallback) {
        sendEventCallback({
          type: 'terminal_exit',
          terminalId: execId,
          exitCode: exitCode,
          duration: Date.now() - startedAt
        });
      }

      return {
        method: 'shell_integration',
        terminal: terminal,
        success: exitCode === 0,
        exitCode: exitCode,
        output: output
      };
    } catch (err) {
      console.error('[TERMINAL] Shell integration executeCommand failed:', err);
      if (sendEventCallback) {
        sendEventCallback({
          type: 'terminal_error',
          terminalId: 'term_error_' + executionCounter,
          message: err.message
        });
      }
      // Fall through to fallback
    }
  }

  // Fallback: use sendText (no shell integration available)
  console.log('[TERMINAL] Falling back to sendText:', command);
  terminal.sendText(command, true);

  if (sendEventCallback) {
    var execId = 'term_fallback_' + (++executionCounter);
    sendEventCallback({
      type: 'terminal_start',
      terminalId: execId,
      command: command,
      fallback: true
    });
    sendEventCallback({
      type: 'terminal_exit',
      terminalId: execId,
      exitCode: null,
      fallback: true,
      message: 'Command sent to terminal (shell integration unavailable). Check the terminal panel for output.'
    });
  }

  return { method: 'sendText', terminal: terminal, success: true, output: '' };
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
