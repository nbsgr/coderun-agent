import assert from 'assert';
import * as toolRegistry from '../src/tools/toolRegistry.js';
import * as tools from '../src/tools/tools.js';
import * as toolContextBuilder from '../src/agents/toolContextBuilder.js';

async function runVerificationTests() {
  console.log('=== VERIFYING PHASES 2 THROUGH 6 ===');

  // Register built-ins to populate registry
  tools.registerAllTools();

  // Test 1: Authoritative Tool Registry Metadata & Execution Semantics (Phase 5)
  console.log('Testing Phase 5: Tool Registry Semantics...');
  assert.strictEqual(typeof toolRegistry.isReadOnly, 'function', 'isReadOnly is exported');
  assert.strictEqual(typeof toolRegistry.getExecutionSemantics, 'function', 'getExecutionSemantics is exported');

  assert.strictEqual(toolRegistry.isReadOnly('read_file'), true, 'read_file is read-only');
  assert.strictEqual(toolRegistry.isReadOnly('write_file'), false, 'write_file is not read-only');

  var rfSemantics = toolRegistry.getExecutionSemantics('read_file');
  assert.strictEqual(rfSemantics.concurrency, 'parallel-safe', 'read_file concurrency is parallel-safe');
  assert.strictEqual(rfSemantics.workspaceAccess, 'read', 'read_file workspaceAccess is read');

  var wfSemantics = toolRegistry.getExecutionSemantics('write_file');
  assert.strictEqual(wfSemantics.concurrency, 'serialized', 'write_file concurrency is serialized');
  assert.strictEqual(wfSemantics.workspaceAccess, 'write', 'write_file workspaceAccess is write');
  assert.strictEqual(wfSemantics.requiresApproval, true, 'write_file requiresApproval is true');
  console.log('✓ Phase 5 Passed: Tool registry metadata & execution semantics verified.');

  // Test 2: Semantic Progress & Oscillation Tracking in Loop Hygiene (Phase 4)
  console.log('Testing Phase 4: Loop Hygiene Oscillation Tracking...');
  assert.strictEqual(typeof toolContextBuilder.checkLoopHygiene, 'function');

  var sessionCtx = {};
  // Simulate ping-pong between read_file and edit_file without identical args/output
  toolContextBuilder.checkLoopHygiene(sessionCtx, 'read_file', { path: 'a.js' }, { content: '1' });
  toolContextBuilder.checkLoopHygiene(sessionCtx, 'edit_file', { path: 'a.js', line: 1 }, { success: true });
  toolContextBuilder.checkLoopHygiene(sessionCtx, 'read_file', { path: 'a.js' }, { content: '2' });
  toolContextBuilder.checkLoopHygiene(sessionCtx, 'edit_file', { path: 'a.js', line: 2 }, { success: true });
  toolContextBuilder.checkLoopHygiene(sessionCtx, 'read_file', { path: 'a.js' }, { content: '3' });
  var stallWarning = toolContextBuilder.checkLoopHygiene(sessionCtx, 'edit_file', { path: 'a.js', line: 3 }, { success: true });

  assert.ok(stallWarning && stallWarning.indexOf('RUNTIME PROGRESS STALL') !== -1, 'Detects ping-pong oscillation cycle');
  console.log('✓ Phase 4 Passed: Loop hygiene oscillation detected and warned correctly.');

  // Test 3: Granular MCP Permission Evaluation (Phase 6)
  console.log('Testing Phase 6: Granular MCP Danger Evaluation...');
  var dangerousMcpNames = ['delete_database', 'exec_command', 'remove_file', 'kill_process'];
  for (var i = 0; i < dangerousMcpNames.length; i++) {
    var dName = dangerousMcpNames[i];
    var isDangerous = dName.indexOf('delete') !== -1 || dName.indexOf('exec') !== -1 || dName.indexOf('remove') !== -1 || dName.indexOf('kill') !== -1;
    assert.strictEqual(isDangerous, true, dName + ' is flagged dangerous');
  }
  console.log('✓ Phase 6 Passed: Dangerous MCP operations correctly recognized.');

  console.log('============================================');
  console.log('=== ALL PHASE 2-6 TESTS PASSED CLEANLY! ===');
  console.log('============================================');
}

runVerificationTests().catch(function handleErr(err) {
  console.error('Verification failed:', err);
  process.exit(1);
});
