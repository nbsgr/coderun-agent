// toolDefinitions.js — Tool schemas for LLM function calling
// Each tool registers itself here. The agent never hardcodes tool specs.

var definitions = [];
var definitionMap = {};

export function registerTool(name, description, parameters, required) {
  var def = {
    type: "function",
    function: {
      name: name,
      description: description,
      parameters: {
        type: "object",
        properties: parameters || {},
        required: required || []
      }
    }
  };
  definitions.push(def);
  definitionMap[name] = def;
}

export function getDefinitions() {
  return definitions;
}

export function getDefinition(name) {
  return definitionMap[name] || null;
}

export function clearDefinitions() {
  definitions = [];
  definitionMap = {};
}

// ── Register all tools ─────────────────────────────

registerTool('read_file',
  "Read the full contents of a file at the given relative path inside the workspace. Returns the file text. Use this BEFORE editing any file so you know what is in it. Also use to inspect code, configs, logs, etc.",
  { file_path: { type: "string", description: "Relative path to the file inside the workspace, e.g. 'src/main.py' or 'README.md'" } },
  ["file_path"]
);

registerTool('write_file',
  "Create a new file or completely overwrite an existing file with the provided content. Parent directories are created automatically. Use this to create new files or when you need to rewrite a file entirely.",
  {
    file_path: { type: "string", description: "Relative path to the file inside the workspace, e.g. 'src/app.js'" },
    content: { type: "string", description: "The complete file content to write" }
  },
  ["file_path", "content"]
);

registerTool('edit_file',
  "Replace the first occurrence of an exact string in a file with a new string. Use this for small, precise edits without rewriting the whole file. The old_string must match exactly (including whitespace and indentation).",
  {
    file_path: { type: "string", description: "Relative path to the file inside the workspace" },
    old_string: { type: "string", description: "The exact string to find (must match precisely including whitespace)" },
    new_string: { type: "string", description: "The string to replace old_string with" }
  },
  ["file_path", "old_string", "new_string"]
);

registerTool('delete_file',
  "Permanently delete a file from the workspace.",
  { file_path: { type: "string", description: "Relative path to the file to delete" } },
  ["file_path"]
);

registerTool('create_folder',
  "Create a directory (and any parent directories) in the workspace.",
  { folder_path: { type: "string", description: "Relative path to the folder to create, e.g. 'src/components'" } },
  ["folder_path"]
);

registerTool('delete_folder',
  "Delete a folder and ALL its contents recursively from the workspace. Use with caution.",
  { folder_path: { type: "string", description: "Relative path to the folder to delete" } },
  ["folder_path"]
);

registerTool('list_directory',
  "List all files and folders in a directory. Returns each entry's name and whether it is a file or directory. Use this to explore and understand the project structure before making changes.",
  { folder_path: { type: "string", description: "Relative path to the folder to list. Use '.' for the workspace root." } },
  []
);

registerTool('search_files',
  "Recursively search for files matching a glob pattern (e.g., '*.py', '*.html', 'test_*') within a folder.",
  {
    pattern: { type: "string", description: "Glob pattern to match filenames, e.g. '*.py', '*.js', 'Dockerfile'" },
    folder_path: { type: "string", description: "Relative path to search in. Defaults to workspace root." }
  },
  ["pattern"]
);

registerTool('get_file_info',
  "Get metadata about a file or folder: size in bytes, last modified time, creation time, and whether it is a file or directory.",
  { file_path: { type: "string", description: "Relative path to the file or folder" } },
  ["file_path"]
);

registerTool('run_terminal',
  "Execute a shell command in the workspace directory and return its stdout, stderr, and exit code. Use for: running builds, installing packages, running tests, git commands, listing processes, checking versions, etc. The command runs with the workspace as the current directory.",
  {
    command: { type: "string", description: "The shell command to execute, e.g. 'npm install', 'python main.py', 'git status'" },
    timeout: { type: "integer", description: "Max seconds to wait. Default 30. Increase for long builds." }
  },
  ["command"]
);

registerTool('get_current_datetime',
  "Get the current date and time. Useful when the user asks about the current time or you need timestamps.",
  {},
  []
);

registerTool('find_in_files',
  "Search the contents of all project files for a text query. Returns matching file paths with context snippets. Use this when you need to find where something is used, defined, or referenced in code. Fast alternative to reading every file manually.",
  {
    query: { type: "string", description: "The text or keyword to search for in file contents, e.g. 'useEffect', 'function calculate', 'TODO'" }
  },
  ["query"]
);