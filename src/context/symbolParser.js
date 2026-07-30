// symbolParser.js — Language-aware symbol parser using regex
// Extracts classes, functions, methods, structs, and traits from source code.

import * as path from 'path';

/**
 * Extract code symbols from a file string based on language extension.
 * @param {string} content - The file content
 * @param {string} filePath - Path of the file (to detect language)
 * @returns {Array<{name: string, type: string, line: number}>}
 */
export function parseSymbols(content, filePath) {
  var ext = path.extname(filePath || '').toLowerCase();
  var lines = content.split('\n');
  var symbols = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var lineNum = i + 1;
    var match = null;

    // JavaScript / TypeScript
    if (ext === '.js' || ext === '.jsx' || ext === '.ts' || ext === '.tsx' || ext === '.mjs' || ext === '.cjs') {
      // 1. Classes
      match = line.match(/^\s*(export\s+)?(default\s+)?class\s+([a-zA-Z0-9_$]+)/);
      if (match) {
        symbols.push({ name: match[3], type: 'class', line: lineNum });
        continue;
      }
      // 2. Named functions
      match = line.match(/^\s*(export\s+)?(default\s+)?(async\s+)?function\s*(\*)?\s+([a-zA-Z0-9_$]+)/);
      if (match) {
        symbols.push({ name: match[5], type: 'function', line: lineNum });
        continue;
      }
      // 3. Arrow function variables
      match = line.match(/^\s*(const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(async\s*)?\([^)]*\)\s*=>/);
      if (match) {
        symbols.push({ name: match[2], type: 'function', line: lineNum });
        continue;
      }
      // 4. Object/Class methods
      match = line.match(/^\s*(async\s*)?(\*)?\s*([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{/);
      if (match) {
        var name = match[3];
        // Ignore keywords
        if (name !== 'if' && name !== 'for' && name !== 'while' && name !== 'switch' && name !== 'catch' && name !== 'function') {
          symbols.push({ name: name, type: 'method', line: lineNum });
        }
        continue;
      }
      // 5. Interface & Types (TS only)
      if (ext.startsWith('.t')) {
        match = line.match(/^\s*(export\s+)?(interface|type)\s+([a-zA-Z0-9_$]+)/);
        if (match) {
          symbols.push({ name: match[3], type: match[2], line: lineNum });
        }
      }
    }
    // Python
    else if (ext === '.py') {
      // 1. Classes
      match = line.match(/^class\s+([a-zA-Z0-9_$]+)/);
      if (match) {
        symbols.push({ name: match[1], type: 'class', line: lineNum });
        continue;
      }
      // 2. Defs (Functions/Methods)
      match = line.match(/^\s*def\s+([a-zA-Z0-9_$]+)/);
      if (match) {
        var isMethod = /^\s+/.test(line); // indented means method inside class
        symbols.push({ name: match[1], type: isMethod ? 'method' : 'function', line: lineNum });
      }
    }
    // Go
    else if (ext === '.go') {
      // 1. Functions (with or without receiver)
      match = line.match(/^func\s+(\([^)]+\)\s+)?([a-zA-Z0-9_$]+)\s*\(/);
      if (match) {
        var hasReceiver = !!match[1];
        symbols.push({ name: match[2], type: hasReceiver ? 'method' : 'function', line: lineNum });
        continue;
      }
      // 2. Structs/Interfaces
      match = line.match(/^type\s+([a-zA-Z0-9_$]+)\s+(struct|interface)/);
      if (match) {
        symbols.push({ name: match[1], type: match[2], line: lineNum });
      }
    }
    // Rust
    else if (ext === '.rs') {
      // 1. Functions
      match = line.match(/^\s*(pub\s+)?(async\s+)?fn\s+([a-zA-Z0-9_$]+)/);
      if (match) {
        symbols.push({ name: match[3], type: 'function', line: lineNum });
        continue;
      }
      // 2. Structs/Traits/Enums
      match = line.match(/^\s*(pub\s+)?(struct|trait|enum|union)\s+([a-zA-Z0-9_$]+)/);
      if (match) {
        symbols.push({ name: match[3], type: match[2], line: lineNum });
        continue;
      }
      // 3. Impl blocks
      match = line.match(/^\s*impl\s+(<[^>]+>\s+)?([a-zA-Z0-9_$]+)/);
      if (match) {
        symbols.push({ name: 'impl ' + match[2], type: 'impl', line: lineNum });
      }
    }
    // C++ / C / Java / C#
    else if (ext === '.java' || ext === '.cpp' || ext === '.h' || ext === '.hpp' || ext === '.cs') {
      // 1. Classes / Structs
      match = line.match(/^\s*(public|private|protected\s+)?(class|struct|interface)\s+([a-zA-Z0-9_$]+)/);
      if (match) {
        symbols.push({ name: match[3], type: match[2], line: lineNum });
        continue;
      }
      // 2. Methods/Functions (general C-style pattern: ReturnType Name(Args) {)
      match = line.match(/^\s*([a-zA-Z0-9_$<>*&::\s]+)\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(\{)?\s*$/);
      if (match) {
        var retType = match[1].trim();
        var name = match[2];
        // Filter common control keywords
        if (name !== 'if' && name !== 'for' && name !== 'while' && name !== 'switch' && name !== 'catch' && !retType.includes('return')) {
          symbols.push({ name: name, type: ext === '.java' || ext === '.cs' ? 'method' : 'function', line: lineNum });
        }
      }
    }
    // Ruby
    else if (ext === '.rb') {
      // 1. Classes/Modules
      match = line.match(/^\s*(class|module)\s+([a-zA-Z0-9_$:]+)/);
      if (match) {
        symbols.push({ name: match[2], type: match[1], line: lineNum });
        continue;
      }
      // 2. Methods
      match = line.match(/^\s*def\s+([a-zA-Z0-9_$.?=]+)/);
      if (match) {
        symbols.push({ name: match[1], type: 'method', line: lineNum });
      }
    }
  }

  return symbols;
}
