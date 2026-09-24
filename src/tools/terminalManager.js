// terminalManager.js — VS Code Terminal with Shell Integration
// Executes commands in isolated VS Code Integrated Terminals per chat session
// and streams output live to the chat UI via shell integration events.

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import * as pathSecurity from './pathSecurity.js';

var _sessions = {}; // sessionId -> sessionState
var terminalListeners = [];
var executionCounter = 0;

function createSessionState(sessionId) {
  return {
    id: sessionId || 'default',
    terminal: null,
    backgroundTerminal: null,
    currentCwd: null,
    backgroundCwd: null,
    lastSessionOutput: '',
    lastBackgroundOutput: '',
    lastSessionActive: false,
    lastBackgroundActive: false,
    lastCheckedPosition: 0,
    lastBackgroundCheckedPosition: 0,
    activeExecId: null,
    activeBackgroundExecId: null,
    activeChildProcess: null,
    backgroundTasks: {},
    pendingInteractiveReader: null,
    pendingInteractiveExecution: null,
    sendEventCallback: null,
    lastMainExecution: null,
    lastBackgroundExecution: null
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
    for (var bgId in sess.backgroundTasks) {
      var bgTask = sess.backgroundTasks[bgId];
      if (bgTask && bgTask.childProcess) {
        killChildProcess(bgTask.childProcess);
        bgTask.childProcess = null;
      }
    }
    if (sess.terminal) {
      try {
        sess.terminal.dispose();
      } catch (_) {
        // Intentionally ignored
      }
      sess.terminal = null;
    }
    if (sess.backgroundTerminal) {
      try {
        sess.backgroundTerminal.dispose();
      } catch (_) {
        // Intentionally ignored
      }
      sess.backgroundTerminal = null;
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

function sleep(ms) {
  function onTimeout(resolve) {
    setTimeout(resolve, ms);
  }
  return new Promise(onTimeout);
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
  /(?:enter|input|type|provide|what|which|how|confirm|specify)\b.*[:?]\s*$/i,
  /\?\s*$/,
  /\$\s*$/,
  /\(END\)\s*$/i,
  /HELP -- Press RETURN/i,
  /SUMMARY OF LESS COMMANDS/i,
  /\(press q to quit\)/i,
  /\.\.\.skipping\.\.\./i
];

function isShellPromptLine(line) {
  if (!line) return false;
  var trimmed = line.trim();
  if (/^PS(\s+[a-zA-Z]:|\s+[\/~]|\s*>|>)/i.test(trimmed)) return true;
  if (/^[\w.-]+@[\w.-]+[:\s].*[$#]\s*$/i.test(trimmed)) return true;
  if (/^(bash|zsh|sh|cmd|pwsh|powershell)[-\d.]*[$#>]\s*$/i.test(trimmed)) return true;
  return false;
}

function detectPrompt(output) {
  if (!output) return { interactive: false, promptDetected: false };
  var trimmed = String(output).trim();
  var lines = trimmed.split('\n');
  var lastLine = lines[lines.length - 1].trim();

  if (isShellPromptLine(lastLine)) {
    return { interactive: false, promptDetected: false };
  }

  var lastLines = lines.slice(-3).join('\n');
  for (var i = 0; i < INTERACTIVE_PATTERNS.length; i++) {
    var pat = INTERACTIVE_PATTERNS[i];
    if (pat.test(lastLines) || pat.test(lastLine)) {
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

  var termName = (sessionId && sessionId !== 'default') ? ('CodeRun(main) (' + sessionId + ')') : 'CodeRun(main)';
  var legacyName = 'CodeRun (' + (sessionId || 'default') + ')';
  var allTerms = (vscode.window && vscode.window.terminals) ? vscode.window.terminals : [];
  for (var i = 0; i < allTerms.length; i++) {
    if (allTerms[i].name === termName || allTerms[i].name === legacyName) {
      sess.terminal = allTerms[i];
      if (!sess.currentCwd && workspace) {
        sess.currentCwd = pathSecurity.getCanonicalWorkspace(workspace);
      }
      return sess.terminal;
    }
  }

  var cwd = workspace || undefined;
  if (!cwd && vscode.workspace && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
  }

  sess.currentCwd = cwd ? pathSecurity.getCanonicalWorkspace(cwd) : null;

  var termOptions = {
    name: termName,
    cwd: cwd,
    env: {
      GIT_PAGER: 'cat',
      PAGER: 'cat'
    }
  };

  if (vscode.TerminalLocation && vscode.TerminalLocation.Panel) {
    termOptions.location = vscode.TerminalLocation.Panel;
  }

  if (vscode.window && typeof vscode.window.createTerminal === 'function') {
    sess.terminal = vscode.window.createTerminal(termOptions);
  } else {
    sess.terminal = null;
    return null;
  }

  function onTerminalClosed(closedTerm) {
    if (closedTerm === sess.terminal) {
      sess.terminal = null;
      sess.currentCwd = null;
      sess.lastSessionActive = false;
      sess.activeExecId = null;
    }
  }

  if (vscode.window && typeof vscode.window.onDidCloseTerminal === 'function') {
    terminalListeners.push(vscode.window.onDidCloseTerminal(onTerminalClosed));
  }
  return sess.terminal;
}

export function getBackgroundTerminal(sessionId, workspace) {
  var sess = getSession(sessionId);
  if (sess.backgroundTerminal) {
    return sess.backgroundTerminal;
  }

  var termName = (sessionId && sessionId !== 'default') ? ('CodeRun(BG) (' + sessionId + ')') : 'CodeRun(BG)';
  var legacyName = 'CodeRun Background (' + (sessionId || 'default') + ')';
  var allTerms = (vscode.window && vscode.window.terminals) ? vscode.window.terminals : [];
  for (var i = 0; i < allTerms.length; i++) {
    if (allTerms[i].name === termName || allTerms[i].name === legacyName) {
      sess.backgroundTerminal = allTerms[i];
      if (!sess.backgroundCwd && workspace) {
        sess.backgroundCwd = pathSecurity.getCanonicalWorkspace(workspace);
      }
      return sess.backgroundTerminal;
    }
  }

  var cwd = workspace || undefined;
  if (!cwd && vscode.workspace && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
  }

  sess.backgroundCwd = cwd ? pathSecurity.getCanonicalWorkspace(cwd) : null;

  var termOptions = {
    name: termName,
    cwd: cwd,
    env: {
      GIT_PAGER: 'cat',
      PAGER: 'cat'
    }
  };

  if (vscode.TerminalLocation && vscode.TerminalLocation.Panel) {
    termOptions.location = vscode.TerminalLocation.Panel;
  }

  if (vscode.window && typeof vscode.window.createTerminal === 'function') {
    sess.backgroundTerminal = vscode.window.createTerminal(termOptions);
  } else {
    sess.backgroundTerminal = null;
    return null;
  }

  function onBgTerminalClosed(closedTerm) {
    if (closedTerm === sess.backgroundTerminal) {
      sess.backgroundTerminal = null;
      sess.backgroundCwd = null;
      sess.lastBackgroundActive = false;
      sess.activeBackgroundExecId = null;
    }
  }

  if (vscode.window && typeof vscode.window.onDidCloseTerminal === 'function') {
    terminalListeners.push(vscode.window.onDidCloseTerminal(onBgTerminalClosed));
  }
  return sess.backgroundTerminal;
}

// ── Interactive command check ───────────────────────────────
var INTERACTIVE_COMMANDS = [
  'ssh', 'sftp', 'ftp', 'telnet',
  'python -i', 'python3 -i', 'node -i', 'irb',
  'mysql', 'psql', 'sqlite3', 'mongo', 'mongosh', 'redis-cli',
  'nano', 'vim', 'vi', 'emacs', 'less', 'more',
  'top', 'htop', 'glances',
  'powershell -noexit', 'cmd /k',
  'read-host', 'set /p ',
  'gh auth', 'git add -p', 'git rebase -i'
];

function isBatchCommand(command) {
  var trimmed = (command || '').trim().toLowerCase();
  if (!trimmed) return false;
  if (trimmed.includes(' -y') || trimmed.includes(' --yes') || trimmed.includes(' -c ') ||
      trimmed.includes(' -command ') || trimmed.includes(' --non-interactive') ||
      trimmed.includes(' --batch') || trimmed.includes(' --template') || trimmed.includes(' -f ')) {
    return true;
  }
  return false;
}

function checkInteractiveCommand(command) {
  var trimmed = (command || '').trim().toLowerCase();
  if (!trimmed) return false;
  if (isBatchCommand(trimmed)) return false;
  if (trimmed.includes('read-host') || trimmed.includes('set /p ') || trimmed.includes('input(')) {
    return true;
  }
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

var BLOCKING_TTY_COMMANDS = [
  'nano', 'vim', 'vi', 'emacs', 'less', 'more',
  'top', 'htop', 'glances'
];

export function isBlockingTtyCommand(command) {
  var trimmed = (command || '').trim().toLowerCase();
  if (!trimmed) return false;
  var words = trimmed.split(/\s+/);
  var exe = words[0];
  for (var i = 0; i < BLOCKING_TTY_COMMANDS.length; i++) {
    if (exe === BLOCKING_TTY_COMMANDS[i]) return true;
  }
  return false;
}

export function isInteractiveCommand(command) {
  return checkInteractiveCommand(command);
}

export function isPrompt(output) {
  return detectPrompt(output).interactive;
}

function createExecFilePromise(shellExe, fullArgs, cwd, timeout, sess, onChunk) {
  function executeFilePromise(resolve) {
    var options = {
      cwd: cwd || undefined,
      timeout: (timeout || 30) * 1000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      env: Object.assign({}, process.env, { GIT_PAGER: 'cat', PAGER: 'cat' })
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
    if (onChunk && childProc.stdout) {
      function onStdoutData(data) {
        onChunk(data.toString(), false);
      }
      childProc.stdout.on('data', onStdoutData);
    }
    if (onChunk && childProc.stderr) {
      function onStderrData(data) {
        onChunk(data.toString(), true);
      }
      childProc.stderr.on('data', onStderrData);
    }
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
  timeoutMs = timeoutMs || 150;
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

function isSameDirectoryPath(p1, p2) {
  if (!p1 || !p2) return false;
  var n1 = path.resolve(String(p1)).replace(/\\/g, '/');
  var n2 = path.resolve(String(p2)).replace(/\\/g, '/');
  if (process.platform === 'win32') {
    return n1.toLowerCase() === n2.toLowerCase();
  }
  return n1 === n2;
}

function getCdCommand(targetPath, shellName) {
  var sName = (shellName || '').toLowerCase();
  var resolved = path.resolve(String(targetPath));
  if (sName.includes('powershell') || sName.includes('pwsh')) {
    return "Set-Location -LiteralPath '" + resolved.replace(/'/g, "''") + "'";
  }
  if (sName.includes('cmd')) {
    return 'cd /d "' + resolved + '"';
  }
  return 'cd "' + resolved.replace(/"/g, '\\"') + '"';
}

function formatSandboxReplacement(match, prefix, sub) {
  var canonicalSandbox = pathSecurity.getCanonicalSandboxRoot();
  var fullPath = sub ? path.join(canonicalSandbox, sub.replace(/^[\\/]/, '')) : canonicalSandbox;
  return prefix + '"' + fullPath + '"';
}

function expandSandboxPathInCommand(cmd, canonicalSandbox) {
  if (!cmd || !canonicalSandbox) return cmd;
  var result = String(cmd);
  if (result.includes('~/.coderun/sandbox') || result.includes('~\\.coderun\\sandbox')) {
    result = result.replace(/~[\\/]\.coderun[\\/]sandbox/g, canonicalSandbox);
  }
  var regexRelSandbox = /(^|[\s"'=])\.coderun[\\/]sandbox([\\/][^\s"'&;|]+)?/g;
  result = result.replace(regexRelSandbox, formatSandboxReplacement);
  return result;
}

export function getCurrentCwd(sessionId) {
  var sess = getSession(sessionId);
  return sess.currentCwd || null;
}

export function setCurrentCwd(sessionId, newCwd) {
  var sess = getSession(sessionId);
  sess.currentCwd = newCwd ? path.resolve(String(newCwd)) : null;
}

export async function executeCommand(command, timeout, background, isInteractive, sessionId, workspace, requestedCwd) {
  timeout = timeout || 30;
  var sess = getSession(sessionId);

  // Model decision takes precedence. Hardcoded checks are only secondary
  // fallbacks when undefined, or for checking special conditions (blocking TTY programs).
  var effectiveInteractive = false;
  if (typeof isInteractive === 'boolean') {
    effectiveInteractive = isInteractive;
    if (!effectiveInteractive && isBlockingTtyCommand(command)) {
      effectiveInteractive = true;
    }
  } else {
    effectiveInteractive = checkInteractiveCommand(command);
  }

  var effectiveBackground = false;
  if (typeof background === 'boolean') {
    effectiveBackground = background;
  } else {
    effectiveBackground = false;
  }

  var terminal = null;
  var bgTerminal = null;

  if (effectiveBackground) {
    bgTerminal = getBackgroundTerminal(sessionId, workspace);
    if (bgTerminal && typeof bgTerminal.show === 'function') {
      bgTerminal.show(true);
    }
  } else {
    terminal = getTerminal(sessionId, workspace);
    if (terminal && typeof terminal.show === 'function') {
      terminal.show(true);
    }
  }

  var canonicalWs = workspace ? pathSecurity.getCanonicalWorkspace(workspace) : '';
  if (!canonicalWs && vscode.workspace && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    canonicalWs = pathSecurity.getCanonicalWorkspace(vscode.workspace.workspaceFolders[0].uri.fsPath);
  }
  var canonicalSandbox = pathSecurity.getCanonicalSandboxRoot();

  if (effectiveBackground) {
    if (!sess.backgroundCwd) {
      sess.backgroundCwd = canonicalWs || (workspace || undefined);
    }
  } else {
    if (!sess.currentCwd) {
      sess.currentCwd = canonicalWs || (workspace || undefined);
    }
  }

  var targetCwd = null;
  if (requestedCwd) {
    var check = pathSecurity.resolveSafePath(requestedCwd, canonicalWs);
    if (check.safe && check.canonicalPath) {
      targetCwd = check.canonicalPath;
    }
  }

  var trimmedCmd = (command || '').trim();

  if (!targetCwd) {
    var isCdToSandbox = /^\s*(?:cd|Set-Location|chdir)\s+(['"]?)(?:~[\\/]\.coderun[\\/]sandbox|\.coderun[\\/]sandbox|[a-zA-Z]:[\\/][^'"]*?\.coderun[\\/]sandbox)/i.test(trimmedCmd);
    var hasSandboxRef = /(?:~[\\/]\.coderun[\\/]sandbox|\.coderun[\\/]sandbox|[a-zA-Z]:[\\/][^'"]*?\.coderun[\\/]sandbox)/i.test(trimmedCmd);
    var isCdToWorkspace = /^\s*(?:cd|Set-Location|chdir)\s+(['"]?)(?:\.\.|[a-zA-Z]:[\\/][^'"]*)/i.test(trimmedCmd) && !hasSandboxRef;

    if (isCdToSandbox || hasSandboxRef) {
      targetCwd = canonicalSandbox;
    } else if (isCdToWorkspace) {
      targetCwd = canonicalWs;
    } else {
      targetCwd = canonicalWs;
    }
  }

  var activeTermForShell = effectiveBackground ? (bgTerminal || terminal) : terminal;
  var shellName = detectShellName(activeTermForShell);
  var platformName = getPlatform();

  // Normalize sandbox paths in command so external executables don't fail on raw ~ or .coderun
  command = expandSandboxPathInCommand(command, canonicalSandbox);

  // Disable git pager to prevent git diff, git log, etc. from hanging on interactive less pager
  if (/^\s*git\s+/i.test(command) || /\b(?:git\s+(?:diff|log|show|branch))\b/i.test(command)) {
    var lowerSh2 = shellName.toLowerCase();
    if (lowerSh2.includes('powershell') || lowerSh2.includes('pwsh')) {
      command = '$env:GIT_PAGER = "cat"; $env:PAGER = "cat"; ' + command;
    } else if (lowerSh2.includes('cmd')) {
      command = 'set GIT_PAGER=cat && set PAGER=cat && ' + command;
    } else {
      command = 'GIT_PAGER=cat PAGER=cat ' + command;
    }
  }

  var currentTermCwd = effectiveBackground ? sess.backgroundCwd : sess.currentCwd;
  var isSameCwd = false;
  if (targetCwd && currentTermCwd) {
    isSameCwd = isSameDirectoryPath(targetCwd, currentTermCwd);
  }

  var isCdOnly = /^\s*(?:cd|Set-Location|chdir)\s+/i.test(trimmedCmd);

  if (targetCwd && !isSameCwd) {
    var cdCmd = getCdCommand(targetCwd, shellName);
    if (isCdOnly) {
      command = cdCmd;
    } else {
      var lowerSh = shellName.toLowerCase();
      if (lowerSh.includes('powershell') || lowerSh.includes('pwsh')) {
        command = cdCmd + '; ' + command;
      } else {
        command = cdCmd + ' && ' + command;
      }
    }
    if (effectiveBackground) {
      sess.backgroundCwd = targetCwd;
    } else {
      sess.currentCwd = targetCwd;
    }
  } else if (isCdOnly && targetCwd) {
    command = getCdCommand(targetCwd, shellName);
  }

  var cwd = targetCwd || (effectiveBackground ? sess.backgroundCwd : sess.currentCwd) || workspace || undefined;
  var startedAt = Date.now();
  var sendEvent = sess.sendEventCallback;

  // Background execution: Track explicit task handle and lifecycle
  if (effectiveBackground) {
    var bgExecId = 'term_bg_' + (++executionCounter);
    sess.activeBackgroundExecId = bgExecId;
    sess.lastBackgroundActive = true;
    var detectedUrl = null;
    var bgStdout = '';
    var bgStderr = '';
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

    if (sendEvent) {
      sendEvent({
        type: 'terminal_start',
        terminalId: bgExecId,
        command: command,
        shell: shellName,
        platform: platformName,
        cwd: cwd,
        background: true,
        terminalName: bgTerminal ? bgTerminal.name : ('CodeRun Background (' + (sessionId || 'default') + ')')
      });
    }

    // 1. If visible VS Code Background Terminal exists and has Shell Integration
    var bgShellIntegration = null;
    if (bgTerminal) {
      bgShellIntegration = bgTerminal.shellIntegration;
      if (!bgShellIntegration && typeof vscode.window.onDidChangeTerminalShellIntegration === 'function') {
        try {
          bgShellIntegration = await waitForShellIntegration(bgTerminal, 150);
        } catch (_) {}
      }
    }

    if (bgTerminal && bgShellIntegration) {
      try {
        console.log('[TERMINAL] Executing background command via Shell Integration in', bgTerminal.name, ':', command);
        var bgExecution = bgShellIntegration.executeCommand(command);
        var bgStream = bgExecution.read();

        sess.backgroundTasks[bgExecId] = {
          id: bgExecId,
          command: command,
          status: 'running',
          startedAt: startedAt,
          childProcess: null,
          terminal: bgTerminal,
          execution: bgExecution,
          url: null
        };

        async function readBgStream() {
          try {
            for await (var chunk of bgStream) {
              var cleanChunk = stripAnsi(String(chunk));
              if (cleanChunk) {
                bgStdout += cleanChunk;
                sess.lastBackgroundOutput += cleanChunk;
                if (!detectedUrl) {
                  var m = bgStdout.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):[0-9]+/i);
                  if (m) {
                    detectedUrl = m[0].replace('0.0.0.0', 'localhost');
                    if (sess.backgroundTasks[bgExecId]) {
                      sess.backgroundTasks[bgExecId].url = detectedUrl;
                    }
                  }
                }
                if (sess.lastBackgroundExecution && sess.lastBackgroundExecution.taskId === bgExecId) {
                  sess.lastBackgroundExecution.stdout = bgStdout;
                  if (detectedUrl) {
                    sess.lastBackgroundExecution.url = detectedUrl;
                  }
                }
                if (sendEvent) {
                  sendEvent({
                    type: 'terminal_output',
                    terminalId: bgExecId,
                    chunk: cleanChunk,
                    background: true
                  });
                }
              }
            }
            var taskObj = sess.backgroundTasks[bgExecId];
            if (taskObj && taskObj.status !== 'cancelled') {
              taskObj.status = 'completed';
              taskObj.endedAt = Date.now();
              if (sess.lastBackgroundExecution && sess.lastBackgroundExecution.taskId === bgExecId) {
                sess.lastBackgroundExecution.status = 'completed';
                sess.lastBackgroundExecution.exitCode = 0;
                sess.lastBackgroundExecution.endedAt = Date.now();
                sess.lastBackgroundExecution.durationMs = Date.now() - startedAt;
              }
              if (sendEvent) {
                sendEvent({
                  type: 'terminal_exit',
                  terminalId: bgExecId,
                  exitCode: 0,
                  duration: Date.now() - startedAt,
                  shell: shellName,
                  platform: platformName,
                  cwd: cwd,
                  command: command,
                  background: true
                });
              }
            }
          } catch (_) {}
        }
        readBgStream();

        await sleep(1500);

        var taskRecord = sess.backgroundTasks[bgExecId];
        var finalUrl = detectedUrl || (taskRecord ? taskRecord.url : null);

        var bgSiResult = {
          shell: shellName,
          platform: platformName,
          command: command,
          taskId: bgExecId,
          url: finalUrl,
          stdout: bgStdout,
          stderr: bgStderr,
          exitCode: null,
          durationMs: Date.now() - startedAt,
          success: true,
          workingDirectory: cwd,
          background: true,
          status: 'running',
          terminalName: bgTerminal.name,
          message: finalUrl
            ? ('Background server started and listening on ' + finalUrl + ' (taskId: ' + bgExecId + ').')
            : ('Background command started in terminal ' + bgTerminal.name + ' (taskId: ' + bgExecId + ').')
        };
        sess.lastBackgroundExecution = {
          command: command,
          stdout: bgStdout,
          stderr: bgStderr,
          exitCode: null,
          durationMs: Date.now() - startedAt,
          success: true,
          status: 'running',
          startedAt: startedAt,
          endedAt: null,
          cwd: cwd,
          shell: shellName,
          platform: platformName,
          taskId: bgExecId,
          url: finalUrl,
          background: true
        };
        return bgSiResult;
      } catch (bgSiErr) {
        console.warn('[TERMINAL] Background shell integration failed, falling back:', bgSiErr.message);
      }
    }

    // 2. Headless / Non-shell-integration fallback (executes process and sniffs output)
    try {
      if (bgTerminal) {
        try {
          if (cwd) {
            bgTerminal.sendText(getCdCommand(cwd, shellName), true);
          }
          bgTerminal.sendText(command, true);
        } catch (_) {}
      }
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
          if (sess.lastBackgroundExecution && sess.lastBackgroundExecution.taskId === bgExecId) {
            sess.lastBackgroundExecution.status = t.status;
            sess.lastBackgroundExecution.exitCode = t.exitCode;
            sess.lastBackgroundExecution.endedAt = t.endedAt;
            sess.lastBackgroundExecution.durationMs = Date.now() - startedAt;
            sess.lastBackgroundExecution.success = !error;
          }
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
      if (bgProcess && bgProcess.stdout) {
        function onBgStdoutData(chunk) {
          var cleanChunk = stripAnsi(chunk.toString());
          bgStdout += cleanChunk;
          if (sess.lastBackgroundExecution && sess.lastBackgroundExecution.taskId === bgExecId) {
            sess.lastBackgroundExecution.stdout = bgStdout;
          }
          if (sendEvent && cleanChunk) {
            sendEvent({
              type: 'terminal_output',
              terminalId: bgExecId,
              chunk: cleanChunk,
              background: true
            });
          }
        }
        bgProcess.stdout.on('data', onBgStdoutData);
      }
      if (bgProcess && bgProcess.stderr) {
        function onBgStderrData(chunk) {
          var cleanChunk = stripAnsi(chunk.toString());
          bgStderr += cleanChunk;
          if (sess.lastBackgroundExecution && sess.lastBackgroundExecution.taskId === bgExecId) {
            sess.lastBackgroundExecution.stderr = bgStderr;
          }
          if (sendEvent && cleanChunk) {
            sendEvent({
              type: 'terminal_output',
              terminalId: bgExecId,
              chunk: cleanChunk,
              background: true
            });
          }
        }
        bgProcess.stderr.on('data', onBgStderrData);
      }
    } catch (_) {}

    if (bgProcess) {
      for (var sniffIter = 0; sniffIter < 30; sniffIter++) {
        var rawCombinedCheck = (bgStdout + ' ' + bgStderr);
        if (/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):[0-9]+/i.test(rawCombinedCheck)) {
          break;
        }
        await sleep(100);
      }
    }

    var rawCombined = (bgStdout + ' ' + bgStderr);
    var urlMatch = rawCombined.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):[0-9]+/i);
    if (urlMatch) {
      detectedUrl = urlMatch[0].replace('0.0.0.0', 'localhost');
    }

    sess.backgroundTasks[bgExecId] = {
      id: bgExecId,
      command: command,
      status: bgProcess ? 'running' : 'submitted_to_terminal',
      startedAt: startedAt,
      childProcess: bgProcess,
      url: detectedUrl
    };

    var bgResult2 = {
      shell: shellName,
      platform: platformName,
      command: command,
      taskId: bgExecId,
      url: detectedUrl,
      stdout: bgStdout,
      stderr: bgStderr,
      exitCode: null,
      durationMs: Date.now() - startedAt,
      success: true,
      workingDirectory: cwd,
      background: true,
      status: bgProcess ? 'running' : 'submitted_to_terminal',
      message: detectedUrl
        ? ('Background server started and listening on ' + detectedUrl + ' (taskId: ' + bgExecId + ').')
        : ('Background command started successfully (taskId: ' + bgExecId + ').')
    };
    sess.lastBackgroundExecution = {
      command: command,
      stdout: bgStdout,
      stderr: bgStderr,
      exitCode: null,
      durationMs: Date.now() - startedAt,
      success: true,
      status: bgProcess ? 'running' : 'submitted_to_terminal',
      startedAt: startedAt,
      endedAt: null,
      cwd: cwd,
      shell: shellName,
      platform: platformName,
      taskId: bgExecId,
      url: detectedUrl,
      background: true
    };
    return bgResult2;
  }

  // 1. Try Shell Integration execution (wait briefly for integration if terminal was just created)
  var shellIntegration = terminal ? terminal.shellIntegration : null;
  if (!shellIntegration && terminal && typeof vscode.window.onDidChangeTerminalShellIntegration === 'function') {
    try {
      shellIntegration = await waitForShellIntegration(terminal, 150);
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
              await stopTerminal(sess.id, 'foreground');
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
        if (!effectiveInteractive) {
          return;
        }
        var pCheck = detectPrompt(stdout);
        if (pCheck.interactive) {
          promptSilenceTimer = setTimeout(function onPromptDetected() {
            isWaitingForPrompt = true;
            sess.lastSessionActive = true;
            resolveStream(0);
          }, 1500);
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

      var siResult = {
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
      sess.lastMainExecution = {
        command: command,
        stdout: stdout,
        stderr: stderr,
        exitCode: isWaitingForPrompt ? null : exitCode,
        durationMs: durationMs,
        success: isSuccess,
        status: finalStatus,
        startedAt: startedAt,
        endedAt: isWaitingForPrompt ? null : Date.now(),
        cwd: cwd,
        shell: shellName,
        platform: platformName,
        method: 'shell_integration',
        interactive: promptCheck.interactive || isWaitingForPrompt,
        waitingForInput: isWaitingForPrompt,
        promptDetected: promptCheck.promptDetected || isWaitingForPrompt,
        background: false
      };
      return siResult;
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

        var siFailResult = {
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
        sess.lastMainExecution = {
          command: command,
          stdout: stdout,
          stderr: siErr.message,
          exitCode: fallbackExitCode,
          durationMs: failDurationMs,
          success: isRealSuccess,
          status: isTimedOut ? 'timed_out' : (isRealSuccess ? 'completed' : 'failed'),
          startedAt: startedAt,
          endedAt: Date.now(),
          cwd: cwd,
          shell: shellName,
          platform: platformName,
          method: 'shell_integration',
          background: false
        };
        return siFailResult;
      }
    }
  }

  // 2. Child Process Fallback (Executes strictly ONCE only if Shell Integration was not started)
  console.log('[TERMINAL] Using isolated child_process fallback for session', sess.id, ':', command);

  // If interactive (as decided by the model or blocking TTY check), send to VS Code terminal directly without child_process duplicate
  if (effectiveInteractive && !isBatchCommand(command)) {
    if (targetCwd && !isSameCwd) {
      terminal.sendText(getCdCommand(targetCwd, shellName), true);
    }
    terminal.sendText(command, true);
    var interactiveExecId = 'term_interactive_' + (++executionCounter);
    sess.lastSessionActive = true;
    sess.activeExecId = interactiveExecId;
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
    var interactiveResult = {
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
    sess.lastMainExecution = {
      command: command,
      stdout: 'Interactive command running in VS Code terminal.',
      stderr: '',
      exitCode: null,
      durationMs: Date.now() - startedAt,
      success: true,
      status: 'waiting_for_input',
      startedAt: startedAt,
      endedAt: null,
      cwd: cwd,
      shell: shellName,
      platform: platformName,
      method: 'interactive_direct',
      interactive: true,
      waitingForInput: true,
      promptDetected: true,
      background: false
    };
    return interactiveResult;
  }

  // Non-interactive: Execute strictly via execFile
  try {
    if (terminal) {
      if (targetCwd && !isSameCwd) {
        terminal.sendText(getCdCommand(targetCwd, shellName), true);
      }
      terminal.sendText(command, true);
    }
  } catch (_) {}
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
    var chunksSent = 0;
    function onFallbackChunk(chunk, isStderr) {
      if (!chunk) return;
      var clean = stripAnsi(chunk);
      if (clean && sendEvent) {
        chunksSent++;
        sendEvent({ type: 'terminal_output', terminalId: fallbackExecId, chunk: clean });
      }
    }
    var cpResult = await createExecFilePromise(shellExe, fullArgs, cwd, timeout, sess, onFallbackChunk);

    var fbStdout = stripAnsi(cpResult.stdout || '');
    var fbStderr = stripAnsi(cpResult.stderr || '');
    var fbExitCode = cpResult.exitCode;
    var fbDurationMs = Date.now() - startedAt;

    sess.lastSessionOutput += fbStdout;

    if (sendEvent && chunksSent === 0) {
      if (fbStdout) {
        sendEvent({ type: 'terminal_output', terminalId: fallbackExecId, chunk: fbStdout });
      }
      if (fbStderr) {
        sendEvent({ type: 'terminal_output', terminalId: fallbackExecId, chunk: fbStderr });
      }
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
    var fbResult = {
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
    sess.lastMainExecution = {
      command: command,
      stdout: fbStdout,
      stderr: fbStderr,
      exitCode: fbExitCode,
      durationMs: fbDurationMs,
      success: fbExitCode === 0,
      status: fbExitCode === 0 ? 'completed' : 'failed',
      startedAt: startedAt,
      endedAt: Date.now(),
      cwd: cwd,
      shell: shellName,
      platform: platformName,
      method: 'execFile_fallback',
      background: false
    };
    return fbResult;
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
    var cpFailResult = {
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
      error: cpErr.message,
      status: 'failed'
    };
    sess.lastMainExecution = {
      command: command,
      stdout: '',
      stderr: cpErr.message,
      exitCode: -1,
      durationMs: errDuration,
      success: false,
      status: 'failed',
      startedAt: startedAt,
      endedAt: Date.now(),
      cwd: cwd,
      shell: shellName,
      platform: platformName,
      method: 'execFile_fallback',
      background: false
    };
    return cpFailResult;
  }
}

export async function sendTerminalInput(text, sessionId, addNewLine) {
  var sess = getSession(sessionId);
  var term = getTerminal(sessionId);
  term.show(true);

  var rawText = String(text != null ? text : '');
  // Normalize escaped control characters that LLMs frequently output as literal strings
  var cleanText = rawText
    .replace(/\\r\\n/g, '\r\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');

  var shouldAddNewline = addNewLine !== false;
  // If the string itself ended with \r\n or \n, strip trailing newline and send with addNewLine=true
  if (/[\r\n]+$/.test(cleanText)) {
    cleanText = cleanText.replace(/[\r\n]+$/, '');
    shouldAddNewline = true;
  }

  term.sendText(cleanText, shouldAddNewline);

  // Allow shell to process input and emit response into stream buffer
  function waitTimer(resolve) {
    setTimeout(resolve, 350);
  }
  await new Promise(waitTimer);

  var fullOutput = sess.lastSessionOutput || '';
  var responseOutput = fullOutput.substring(sess.lastCheckedPosition);
  sess.lastCheckedPosition = fullOutput.length;

  var isExitCommand = /^\s*(\.exit|exit\(\)|quit\(\)|exit|quit)\s*$/i.test(cleanText);
  if (isExitCommand) {
    sess.lastSessionActive = false;
    sess.activeExecId = null;
  }

  if (sess.lastMainExecution) {
    sess.lastMainExecution.lastInput = cleanText;
    if (responseOutput) {
      sess.lastMainExecution.stdout = (sess.lastMainExecution.stdout ? (sess.lastMainExecution.stdout + '\n') : '') + responseOutput;
    }
    if (isExitCommand) {
      sess.lastMainExecution.status = 'completed';
      sess.lastMainExecution.exitCode = 0;
      sess.lastMainExecution.success = true;
      sess.lastMainExecution.endedAt = Date.now();
    }
  }

  return {
    success: true,
    status: isExitCommand ? 'completed' : 'waiting_for_input',
    stdout: responseOutput,
    output: responseOutput,
    interactive: !isExitCommand,
    message: 'Input sent to terminal: ' + (cleanText || '(empty/newline)') + (responseOutput ? ('\nResponse output:\n' + responseOutput) : '')
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
    interactive: isWaiting || promptCheck.interactive,
    promptDetected: promptCheck.promptDetected
  };
}

export async function getTerminalState(sessionId, options) {
  var sess = getSession(sessionId);
  var isBackground = false;
  if (options) {
    if (options.background === true || options.terminal === 'background' || options.terminal === 'bg') {
      isBackground = true;
    }
  }

  function waitTick(resolve) {
    setTimeout(resolve, 200);
  }
  await new Promise(waitTick);

  if (isBackground) {
    var bgTerm = sess.backgroundTerminal;
    var bgTermName = bgTerm ? bgTerm.name : ((sessionId && sessionId !== 'default') ? ('CodeRun(BG) (' + sessionId + ')') : 'CodeRun(BG)');
    var shellNameBg = bgTerm ? detectShellName(bgTerm) : getShellName(sessionId);
    var platformNameBg = getPlatform();
    var lastBgExec = sess.lastBackgroundExecution;

    var runningBgTask = null;
    for (var bId in sess.backgroundTasks) {
      var task = sess.backgroundTasks[bId];
      if (task && (task.status === 'running' || task.status === 'submitted_to_terminal')) {
        runningBgTask = task;
        break;
      }
    }

    var bgStatus = runningBgTask ? 'running' : (lastBgExec ? lastBgExec.status : 'idle');
    var bgExitCode = runningBgTask ? null : (lastBgExec ? lastBgExec.exitCode : null);
    var bgExitCodeZero = bgExitCode === 0;
    var bgStdout = (lastBgExec && lastBgExec.stdout) || sess.lastBackgroundOutput || '';
    var bgStderr = (lastBgExec && lastBgExec.stderr) || '';
    var bgCommand = (lastBgExec && lastBgExec.command) || (runningBgTask && runningBgTask.command) || '';
    var bgCwd = sess.backgroundCwd || (lastBgExec && lastBgExec.cwd) || '';

    var crossReferencedFromMain = false;
    if (!bgCommand && !lastBgExec && !runningBgTask && (sess.lastMainExecution || sess.lastSessionOutput)) {
      var lastMain = sess.lastMainExecution;
      var mainCmd = (lastMain && lastMain.command) || '';
      var mainOut = (lastMain && lastMain.stdout) || sess.lastSessionOutput || '';
      var mainCode = lastMain ? lastMain.exitCode : null;
      var mainZero = mainCode === 0;
      var mainStat = lastMain ? lastMain.status : 'completed';

      bgCommand = mainCmd ? (mainCmd + ' (ran in Main Terminal)') : '';
      bgStdout = mainOut;
      bgStderr = (lastMain && lastMain.stderr) || '';
      bgExitCode = mainCode;
      bgExitCodeZero = mainZero;
      bgStatus = 'idle';
      bgCwd = (lastMain && lastMain.cwd) || sess.currentCwd || bgCwd;
      crossReferencedFromMain = true;
    }

    var bgMessage = '';
    if (!bgCommand && !lastBgExec && !runningBgTask) {
      bgMessage = 'Background terminal (' + bgTermName + ') is idle. No commands have been executed yet in this session.';
    } else if (runningBgTask) {
      bgMessage = 'Background terminal has an active running task (' + runningBgTask.id + '): `' + bgCommand + '`.' +
        (runningBgTask.url ? (' Listening on ' + runningBgTask.url + '.') : '');
    } else if (crossReferencedFromMain) {
      bgMessage = 'Background terminal (' + bgTermName + ') is idle (no background commands executed).\n' +
        'Note: Recent command ran in Main Terminal (' + (sess.terminal ? sess.terminal.name : 'CodeRun(main)') + '): `' + bgCommand + '`. Status: ' + (sess.lastMainExecution ? sess.lastMainExecution.status : 'completed') +
        (bgExitCode != null ? (' (exit code: ' + bgExitCode + ', exited with zero: ' + bgExitCodeZero + ')') : '') +
        (bgStdout ? ('\nOutput:\n' + bgStdout.substring(Math.max(0, bgStdout.length - 1000))) : '');
    } else {
      bgMessage = 'Background terminal last command: `' + bgCommand + '`. Status: ' + bgStatus +
        (bgExitCode != null ? (' (exit code: ' + bgExitCode + ', exited with zero: ' + bgExitCodeZero + ')') : ' (running)') +
        (bgStdout ? ('\nOutput:\n' + bgStdout.substring(Math.max(0, bgStdout.length - 1000))) : '');
    }

    return {
      terminal: 'background',
      terminalName: bgTermName,
      has_executed_command: !!((lastBgExec && lastBgExec.command) || (runningBgTask && runningBgTask.command)),
      cross_referenced: crossReferencedFromMain,
      command: bgCommand,
      stdout: bgStdout,
      stderr: bgStderr,
      output: bgStdout,
      exit_code: bgExitCode,
      exit_code_zero: bgExitCodeZero,
      status: bgStatus,
      waiting_for_input: false,
      duration_ms: (lastBgExec && lastBgExec.durationMs) || (crossReferencedFromMain && sess.lastMainExecution ? sess.lastMainExecution.durationMs : 0),
      working_directory: bgCwd,
      cwd: bgCwd,
      shell: shellNameBg,
      platform: platformNameBg,
      url: (runningBgTask && runningBgTask.url) || (lastBgExec && lastBgExec.url) || null,
      message: bgMessage
    };
  }

  var mainTerm = sess.terminal;
  var mainTermName = mainTerm ? mainTerm.name : ((sessionId && sessionId !== 'default') ? ('CodeRun(main) (' + sessionId + ')') : 'CodeRun(main)');
  var shellNameMain = mainTerm ? detectShellName(mainTerm) : getShellName(sessionId);
  var platformNameMain = getPlatform();
  var lastMainExec = sess.lastMainExecution;

  var mainOutput = sess.lastSessionOutput || (lastMainExec ? lastMainExec.stdout : '');
  var mainStderr = (lastMainExec && lastMainExec.stderr) || '';
  var mainCommand = (lastMainExec && lastMainExec.command) || '';
  var mainCwd = sess.currentCwd || (lastMainExec && lastMainExec.cwd) || '';

  var isWaiting = sess.lastSessionActive;
  var hasActiveExecution = !!sess.activeExecId || !!sess.activeChildProcess;
  var promptCheck = detectPrompt(mainOutput);
  var isWaitingForInput = isWaiting || promptCheck.interactive || (lastMainExec && lastMainExec.waitingForInput);

  var mainStatus = isWaitingForInput ? 'waiting_for_input' : (hasActiveExecution ? 'active' : (lastMainExec ? lastMainExec.status : 'idle'));
  var mainExitCode = (hasActiveExecution || isWaitingForInput) ? null : (lastMainExec ? lastMainExec.exitCode : null);
  var mainExitCodeZero = mainExitCode === 0;

  var crossReferencedFromBg = false;
  if (!mainCommand && !lastMainExec && !hasActiveExecution && (sess.lastBackgroundExecution || sess.lastBackgroundOutput)) {
    var lastBg = sess.lastBackgroundExecution;
    var bgCmd = (lastBg && lastBg.command) || '';
    var bgOut = (lastBg && lastBg.stdout) || sess.lastBackgroundOutput || '';
    var bgCode = lastBg ? lastBg.exitCode : null;
    var bgZero = bgCode === 0;
    var bgStat = lastBg ? lastBg.status : 'completed';

    mainCommand = bgCmd ? (bgCmd + ' (ran in Background Terminal)') : '';
    mainOutput = bgOut;
    mainStderr = (lastBg && lastBg.stderr) || '';
    mainExitCode = bgCode;
    mainExitCodeZero = bgZero;
    mainStatus = 'idle';
    mainCwd = (lastBg && lastBg.cwd) || sess.backgroundCwd || mainCwd;
    crossReferencedFromBg = true;
  }

  var mainMessage = '';
  if (!mainCommand && !lastMainExec && !hasActiveExecution) {
    mainMessage = 'Main terminal (' + mainTermName + ') is idle. No commands have been executed yet in this session.';
  } else if (isWaitingForInput) {
    mainMessage = 'Main terminal is waiting for user/prompt input for command: `' + mainCommand + '`.' +
      '\nUse `terminal_input` with text to respond, or `stop_terminal` to cancel.' +
      (mainOutput ? ('\nLatest terminal output:\n' + mainOutput.substring(Math.max(0, mainOutput.length - 1000))) : '');
  } else if (hasActiveExecution) {
    mainMessage = 'Main terminal is actively executing command: `' + mainCommand + '`.' +
      (mainOutput ? ('\nLatest terminal output:\n' + mainOutput.substring(Math.max(0, mainOutput.length - 1000))) : '');
  } else if (crossReferencedFromBg) {
    mainMessage = 'Main terminal (' + mainTermName + ') is idle (no main commands executed).\n' +
      'Note: Recent command ran in Background Terminal (' + (sess.backgroundTerminal ? sess.backgroundTerminal.name : 'CodeRun(BG)') + '): `' + mainCommand + '`. Status: ' + (sess.lastBackgroundExecution ? sess.lastBackgroundExecution.status : 'completed') +
      (mainExitCode != null ? (' (exit code: ' + mainExitCode + ', exited with zero: ' + mainExitCodeZero + ')') : '') +
      (mainOutput ? ('\nOutput:\n' + mainOutput.substring(Math.max(0, mainOutput.length - 1000))) : '');
  } else {
    mainMessage = 'Main terminal last command: `' + mainCommand + '`. Status: ' + mainStatus +
      (mainExitCode != null ? (' (exit code: ' + mainExitCode + ', exited with zero: ' + mainExitCodeZero + ')') : '') +
      (mainOutput ? ('\nOutput:\n' + mainOutput.substring(Math.max(0, mainOutput.length - 1000))) : '');
  }

  return {
    terminal: 'main',
    terminalName: mainTermName,
    has_executed_command: !!((lastMainExec && lastMainExec.command) || (sess.activeExecId && mainCommand)),
    cross_referenced: crossReferencedFromBg,
    command: mainCommand,
    stdout: mainOutput,
    stderr: mainStderr,
    output: mainOutput,
    exit_code: mainExitCode,
    exit_code_zero: mainExitCodeZero,
    status: mainStatus,
    waiting_for_input: isWaitingForInput,
    duration_ms: (lastMainExec && lastMainExec.durationMs) || (crossReferencedFromBg && sess.lastBackgroundExecution ? sess.lastBackgroundExecution.durationMs : 0),
    working_directory: mainCwd,
    cwd: mainCwd,
    shell: shellNameMain,
    platform: platformNameMain,
    message: mainMessage
  };
}

export async function stopTerminal(sessionId, target) {
  var sess = getSession(sessionId);
  var normTarget = String(target || 'all').toLowerCase();
  var stopMain = normTarget === 'all' || normTarget === 'foreground' || normTarget === 'main' || normTarget === 'direct';
  var stopBg = normTarget === 'all' || normTarget === 'background' || normTarget === 'bg';

  var hadActiveProcess = false;

  // 1. Stop active fallback child process if running on main
  if (stopMain && sess.activeChildProcess) {
    console.log('[TERMINAL] Stopping active child process for session', sess.id);
    killChildProcess(sess.activeChildProcess);
    sess.activeChildProcess = null;
    hadActiveProcess = true;
  }

  // 2. Stop any running background tasks if background targeted
  if (stopBg) {
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
    if (sess.lastBackgroundExecution && (sess.lastBackgroundExecution.status === 'running' || sess.lastBackgroundExecution.status === 'active')) {
      sess.lastBackgroundExecution.status = 'stopped';
      sess.lastBackgroundExecution.exitCode = 130;
      sess.lastBackgroundExecution.success = false;
      sess.lastBackgroundExecution.endedAt = Date.now();
    }
  }

  // 3. Send Ctrl+C interrupt to background terminal if active and requested
  if (stopBg && sess.backgroundTerminal && (sess.lastBackgroundActive || sess.activeBackgroundExecId || hadActiveProcess)) {
    try {
      sess.backgroundTerminal.sendText('\u0003', false);
    } catch (_) {}
    sess.lastBackgroundActive = false;
    sess.activeBackgroundExecId = null;
    hadActiveProcess = true;
  }

  // 4. Send Ctrl+C interrupt directly to CodeRun(main) terminal if active and requested
  if (stopMain && sess.terminal && (sess.lastSessionActive || sess.activeExecId || hadActiveProcess)) {
    hadActiveProcess = true;
    try {
      sess.terminal.show(true);
      sess.terminal.sendText('\u0003', false);
    } catch (_) {}

    console.log('[TERMINAL] Sent Ctrl+C interrupt to CodeRun(main) terminal:', sess.id);

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

    if (sess.lastMainExecution && (sess.lastMainExecution.status === 'running' || sess.lastMainExecution.status === 'active' || sess.lastMainExecution.status === 'waiting_for_input')) {
      sess.lastMainExecution.status = 'stopped';
      sess.lastMainExecution.exitCode = 130;
      sess.lastMainExecution.success = false;
      sess.lastMainExecution.endedAt = Date.now();
    }

    return {
      success: true,
      status: 'stopped',
      target: normTarget,
      message: 'Sent Ctrl+C to stop running process in CodeRun(main) terminal.'
    };
  }

  if (hadActiveProcess) {
    if (stopMain) {
      sess.lastSessionActive = false;
      sess.activeExecId = null;
      if (sess.lastMainExecution && (sess.lastMainExecution.status === 'running' || sess.lastMainExecution.status === 'active' || sess.lastMainExecution.status === 'waiting_for_input')) {
        sess.lastMainExecution.status = 'stopped';
        sess.lastMainExecution.exitCode = 130;
        sess.lastMainExecution.success = false;
        sess.lastMainExecution.endedAt = Date.now();
      }
    }
    return {
      success: true,
      status: 'stopped',
      target: normTarget,
      message: stopBg && !stopMain
        ? 'Stopped background process in CodeRun(BG) terminal.'
        : 'Stopped running terminal process.'
    };
  }

  return {
    success: false,
    status: 'not_running',
    target: normTarget,
    message: 'No active command or process was running in the requested terminal (' + normTarget + ').'
  };
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
  if (sess.backgroundTerminal) {
    try {
      sess.backgroundTerminal.dispose();
    } catch (_) {
      // Intentionally ignored
    }
    sess.backgroundTerminal = null;
  }
  sess.lastSessionOutput = '';
  sess.lastBackgroundOutput = '';
  sess.lastSessionActive = false;
  sess.lastBackgroundActive = false;
  sess.lastCheckedPosition = 0;
  sess.lastBackgroundCheckedPosition = 0;
  sess.activeExecId = null;
  sess.activeBackgroundExecId = null;
  sess.backgroundTasks = {};
  sess.lastMainExecution = null;
  sess.lastBackgroundExecution = null;
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
  if (sess.backgroundTerminal) {
    try {
      sess.backgroundTerminal.sendText('\u0003', false);
    } catch (_) {}
  } else if (sess.terminal) {
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
      console.log('[TERMINAL] Main terminal closed for session:', sid);
      sess.terminal = null;
      sess.lastSessionActive = false;
      sess.activeExecId = null;
      sess.pendingInteractiveReader = null;
      sess.pendingInteractiveExecution = null;
    }
    if (sess && sess.backgroundTerminal === terminal) {
      console.log('[TERMINAL] Background terminal closed for session:', sid);
      sess.backgroundTerminal = null;
      sess.lastBackgroundActive = false;
      sess.activeBackgroundExecId = null;
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
