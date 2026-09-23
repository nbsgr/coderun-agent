// Test verifying subagent dedicated provider and model resolution
import assert from 'assert';
import * as subagentManager from '../src/agents/subagentManager.js';
import * as config from '../src/agents/config.js';

function createMockContext() {
  var state = {};
  var secrets = {};
  return {
    globalState: {
      get: function get(key, fallback) {
        return state[key] !== undefined ? state[key] : fallback;
      },
      update: function update(key, value) {
        state[key] = value;
        return Promise.resolve();
      }
    },
    secrets: {
      get: function get(key) {
        return Promise.resolve(secrets[key] || '');
      },
      store: function store(key, val) {
        secrets[key] = val;
        return Promise.resolve();
      },
      delete: function del(key) {
        delete secrets[key];
        return Promise.resolve();
      }
    }
  };
}

async function runTests() {
  console.log('--- Starting Subagent Provider Resolution Tests ---');

  var mockContext = createMockContext();
  subagentManager.initializePersistence(mockContext);

  // 1. Save custom compatible provider config in mock storage
  var customProv = 'compatible:ollama(satish)';
  var customCfg = {
    baseUrl: 'http://192.168.1.100:11434/v1',
    model: 'gpt-oss:120b',
    apiType: 'openai'
  };
  await config.saveProviderConfig(mockContext, customProv, customCfg);

  // 2. Configure subagent defaults
  subagentManager.configureSubagentDefaults({
    provider: customProv,
    model: 'gpt-oss:120b'
  });
  var defaults = subagentManager.getSubagentDefaults();
  assert.strictEqual(defaults.provider, customProv, 'Subagent default provider should match');
  assert.strictEqual(defaults.model, 'gpt-oss:120b', 'Subagent default model should match');
  console.log('✓ configureSubagentDefaults correctly stored provider and model');

  // 3. Verify getProviderConfigByName resolves custom baseUrl
  var resolvedProv = await config.getProviderConfigByName(mockContext, customProv);
  assert.strictEqual(resolvedProv.baseUrl, 'http://192.168.1.100:11434/v1', 'BaseUrl should match custom server');
  assert.strictEqual(resolvedProv.provider, customProv, 'Provider name should match');
  console.log('✓ getProviderConfigByName resolved custom provider baseUrl correctly');

  // 4. Test spawnSubagent execution applies custom baseUrl, apiKey, apiType, model
  var executedChildConfig = null;
  function mockRunner(task, childCfg, loopOptions) {
    executedChildConfig = childCfg;
    return Promise.resolve({
      success: true,
      stopped: false,
      toolFailures: []
    });
  }

  var parentContext = {
    sessionId: 'session_test_parent',
    config: {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5-coder:7b'
    },
    agentRunner: mockRunner,
    sendEvent: function sendEvent() {}
  };

  var record = subagentManager.spawnSubagent({
    id: 'test_subagent_1',
    task: 'Delete the package.json file',
    execution: 'sync'
  }, parentContext);

  assert.strictEqual(record.provider, customProv, 'Record provider should be custom provider');
  assert.strictEqual(record.model, 'gpt-oss:120b', 'Record model should be custom model');

  // Wait for async task to run
  await record.promise;

  assert.ok(executedChildConfig, 'Runner should have been executed');
  assert.strictEqual(executedChildConfig.provider, customProv, 'Runner should receive custom provider');
  assert.strictEqual(executedChildConfig.baseUrl, 'http://192.168.1.100:11434/v1', 'Runner MUST receive custom baseUrl, not localhost');
  assert.strictEqual(executedChildConfig.model, 'gpt-oss:120b', 'Runner MUST receive custom model');
  assert.strictEqual(executedChildConfig.apiType, 'openai', 'Runner MUST receive custom apiType');
  console.log('✓ runSubagentTask successfully passed custom server baseUrl & model to childConfig!');

  // 5. Test listSubagents includes model and provider
  var subsList = subagentManager.listSubagents('session_test_parent');
  assert.ok(subsList.length > 0, 'listSubagents should return at least one subagent');
  var foundSub = subsList.find(function findSub(s) { return s.id === 'test_subagent_1'; });
  assert.ok(foundSub, 'Should find test_subagent_1');
  assert.strictEqual(foundSub.provider, customProv, 'listSubagents item should have custom provider');
  assert.strictEqual(foundSub.model, 'gpt-oss:120b', 'listSubagents item should have custom model');
  console.log('✓ listSubagents correctly reports subagent provider and model');

  console.log('--- ALL TESTS PASSED ---');
}

runTests().catch(function onError(err) {
  console.error('Test failed:', err);
  process.exit(1);
});
