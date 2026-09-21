// pythonMcpManager.js — Pure JavaScript Python MCP Server & Environment Manager
// Manages Python MCP discovery, isolated virtualenv (~/.coderun/python-env/),
// unbuffered stdio runtime, and package verification with zero project pollution.

import * as path from 'path';
import * as os from 'os';
import { existsSync, mkdirSync } from 'fs';
import { execFile } from 'child_process';

var PYTHON_ENV_DIR_NAME = 'python-env';
var cachedSystemPython = null;
var cachedUvx = null;

export function getCodeRunPythonEnvDir() {
  return path.join(os.homedir(), '.coderun', PYTHON_ENV_DIR_NAME);
}

export function getVenvPythonPath(venvDir) {
  var base = venvDir || getCodeRunPythonEnvDir();
  if (process.platform === 'win32') {
    return path.join(base, 'Scripts', 'python.exe');
  }
  return path.join(base, 'bin', 'python');
}

export function getVenvPipPath(venvDir) {
  var base = venvDir || getCodeRunPythonEnvDir();
  if (process.platform === 'win32') {
    return path.join(base, 'Scripts', 'pip.exe');
  }
  return path.join(base, 'bin', 'pip');
}

export function isPythonCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') return false;
  var lower = cmd.toLowerCase().trim();
  return (
    lower === 'python' ||
    lower === 'python3' ||
    lower === 'py' ||
    lower === 'uvx' ||
    lower.endsWith('.py') ||
    lower.includes('python.exe') ||
    lower.includes('python3.exe') ||
    lower.includes('/python') ||
    lower.includes('\\python')
  );
}

export function findSystemPython() {
  if (cachedSystemPython) {
    return Promise.resolve(cachedSystemPython);
  }

  function executor(resolve) {
    var candidates = process.platform === 'win32'
      ? ['python', 'py', 'python3']
      : ['python3', 'python'];

    function checkCandidate(index) {
      if (index >= candidates.length) {
        resolve(null);
        return;
      }
      var candidate = candidates[index];
      execFile(candidate, ['--version'], { timeout: 5000 }, function onVersionChecked(err, stdout, stderr) {
        if (!err && ((stdout && stdout.toLowerCase().includes('python')) || (stderr && stderr.toLowerCase().includes('python')))) {
          cachedSystemPython = candidate;
          resolve(candidate);
        } else {
          checkCandidate(index + 1);
        }
      });
    }

    checkCandidate(0);
  }

  return new Promise(executor);
}

export function findUvx() {
  if (cachedUvx !== null) {
    return Promise.resolve(cachedUvx);
  }

  function executor(resolve) {
    var uvxCmd = process.platform === 'win32' ? 'uvx.cmd' : 'uvx';
    execFile(uvxCmd, ['--version'], { timeout: 5000 }, function onUvxChecked(err) {
      if (!err) {
        cachedUvx = uvxCmd;
        resolve(uvxCmd);
      } else {
        execFile('uvx', ['--version'], { timeout: 5000 }, function onFallbackChecked(err2) {
          if (!err2) {
            cachedUvx = 'uvx';
            resolve('uvx');
          } else {
            cachedUvx = false;
            resolve(null);
          }
        });
      }
    });
  }

  return new Promise(executor);
}

export function detectWorkspacePython(workspaceDir) {
  if (!workspaceDir || typeof workspaceDir !== 'string') return null;

  var possibleVenvs = [
    path.join(workspaceDir, '.venv'),
    path.join(workspaceDir, 'venv'),
    path.join(workspaceDir, 'env')
  ];

  for (var i = 0; i < possibleVenvs.length; i++) {
    var venvDir = possibleVenvs[i];
    var venvExe = getVenvPythonPath(venvDir);
    if (existsSync(venvExe)) {
      return venvExe;
    }
  }

  return null;
}

export function ensureCodeRunVenv(systemPython) {
  var venvDir = getCodeRunPythonEnvDir();
  var venvPython = getVenvPythonPath(venvDir);

  if (existsSync(venvPython)) {
    return Promise.resolve(venvPython);
  }

  function executor(resolve, reject) {
    try {
      if (!existsSync(venvDir)) {
        mkdirSync(venvDir, { recursive: true });
      }
    } catch (_) {}

    var sysPy = systemPython || cachedSystemPython || 'python';
    console.log('[PYTHON MCP] Creating isolated CodeRun virtualenv at:', venvDir);

    execFile(sysPy, ['-m', 'venv', venvDir], { timeout: 60000 }, function onVenvCreated(err, stdout, stderr) {
      if (err) {
        console.warn('[PYTHON MCP] Failed to create virtualenv with ' + sysPy + ':', err.message);
        resolve(sysPy);
      } else {
        console.log('[PYTHON MCP] Successfully created isolated virtualenv at:', venvDir);
        resolve(venvPython);
      }
    });
  }

  return new Promise(executor);
}

export function isPackageInstalled(pythonExe, packageName) {
  function executor(resolve) {
    if (!packageName) {
      resolve(false);
      return;
    }

    var modName = String(packageName).replace(/-/g, '_');
    var script = 'import ' + modName + '; print("OK")';

    execFile(pythonExe, ['-c', script], { timeout: 6000 }, function onImportCheck(err, stdout) {
      if (!err && stdout && stdout.trim() === 'OK') {
        resolve(true);
      } else {
        execFile(pythonExe, ['-m', 'pip', 'show', packageName], { timeout: 6000 }, function onPipShow(err2) {
          resolve(!err2);
        });
      }
    });
  }

  return new Promise(executor);
}

export function installPackage(pythonExe, packageName) {
  function executor(resolve, reject) {
    if (!packageName) {
      reject(new Error('Package name is required'));
      return;
    }

    console.log('[PYTHON MCP] Installing package "' + packageName + '" using:', pythonExe);
    execFile(pythonExe, ['-m', 'pip', 'install', packageName], { timeout: 120000 }, function onInstalled(err, stdout, stderr) {
      if (err) {
        reject(new Error('Failed to install ' + packageName + ': ' + (stderr || err.message)));
      } else {
        console.log('[PYTHON MCP] Successfully installed package:', packageName);
        resolve({ success: true, stdout: stdout, stderr: stderr });
      }
    });
  }

  return new Promise(executor);
}

export function extractPackageName(args) {
  if (!args) return null;
  var list = Array.isArray(args) ? args : String(args).split(' ');
  for (var i = 0; i < list.length; i++) {
    var item = list[i].trim();
    if (item === '-m' && i + 1 < list.length) {
      return list[i + 1].trim();
    }
    if (item.startsWith('mcp-server-') || item.startsWith('mcp_server_')) {
      return item;
    }
  }
  return null;
}

export async function preparePythonSpawn(config, workspaceDir) {
  var originalCmd = config.command || 'python';
  var rawArgs = config.args || [];
  var args = Array.isArray(rawArgs) ? rawArgs.slice() : [String(rawArgs)];

  var finalCmd = originalCmd;
  var finalCwd = config.cwd || workspaceDir || undefined;

  // Build unbuffered, UTF-8 Python environment
  var finalEnv = Object.assign({}, process.env, config.env || {});
  finalEnv.PYTHONUNBUFFERED = '1';
  finalEnv.PYTHONIOENCODING = 'utf-8';

  var isWin = process.platform === 'win32';
  var useShell = false;

  // 1. If command is uvx, check uvx availability
  if (originalCmd.toLowerCase() === 'uvx') {
    var uvxPath = await findUvx();
    if (uvxPath) {
      finalCmd = uvxPath;
      if (isWin) useShell = true;
      return {
        command: finalCmd,
        args: args,
        env: finalEnv,
        cwd: finalCwd,
        useShell: useShell
      };
    }
  }

  // 2. Check for workspace virtualenv first (.venv)
  var wsVenv = detectWorkspacePython(workspaceDir);
  if (wsVenv) {
    finalCmd = wsVenv;
  } else {
    // 3. Fallback to system Python or isolated CodeRun virtualenv
    var sysPy = await findSystemPython();
    if (sysPy) {
      var isolatedVenvExe = getVenvPythonPath(getCodeRunPythonEnvDir());
      if (existsSync(isolatedVenvExe)) {
        finalCmd = isolatedVenvExe;
      } else {
        finalCmd = sysPy;
      }
    }
  }

  // Ensure -u (unbuffered) argument is present if invoking script/module
  var hasUnbufferedFlag = false;
  for (var a = 0; a < args.length; a++) {
    if (args[a] === '-u') {
      hasUnbufferedFlag = true;
      break;
    }
  }
  if (!hasUnbufferedFlag && !args.includes('-c')) {
    args.unshift('-u');
  }

  // If command is a python executable (not uvx) and argument is a package/module name without -m, insert -m
  if (!args.includes('-m') && !args.includes('-c')) {
    for (var aIdx = 0; aIdx < args.length; aIdx++) {
      if (args[aIdx] !== '-u' && !args[aIdx].startsWith('-') && !args[aIdx].endsWith('.py')) {
        args[aIdx] = args[aIdx].replace(/-/g, '_');
        args.splice(aIdx, 0, '-m');
        break;
      }
    }
  }

  // Check if a package was specified and needs installation
  var pkgName = extractPackageName(args);
  if (pkgName && !pkgName.endsWith('.py')) {
    try {
      var installed = await isPackageInstalled(finalCmd, pkgName);
      if (!installed) {
        console.log('[PYTHON MCP] Package "' + pkgName + '" not found in environment. Attempting install...');
        await installPackage(finalCmd, pkgName);
      }
    } catch (installErr) {
      console.warn('[PYTHON MCP] Pre-install check/install error:', installErr.message);
    }
  }

  return {
    command: finalCmd,
    args: args,
    env: finalEnv,
    cwd: finalCwd,
    useShell: useShell
  };
}

export function formatPythonMissingModuleTip(stderrText) {
  if (!stderrText || typeof stderrText !== 'string') return '';
  var match = stderrText.match(/No module named ['"]?([^'"\r\n\s]+)['"]?/i);
  if (match && match[1]) {
    var missingMod = match[1];
    var pipPkg = missingMod.replace(/_/g, '-');
    return '\n\n💡 CodeRun Tip: Python module "' + missingMod + '" is not installed in your Python environment.\n' +
      '• To install it, run: pip install ' + pipPkg + '\n' +
      '• Or if running a local script, specify the file path: -u server.py (or path/to/script.py)\n' +
      '• If you have uv installed, you can also run it via: uvx ' + pipPkg;
  }
  return '';
}

export function getPythonTemplateConfig() {
  return {
    id: 'python',
    name: 'python-server',
    command: 'python',
    args: '-u server.py',
    transport: 'stdio',
    description: 'Local Python MCP Server (runs in isolated CodeRun environment)',
    placeholder: 'e.g. -u server.py or -u -m mcp_server_sqlite'
  };
}
