module.exports = {
  env: {
    node: true,
    es2022: true,
    browser: true
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  rules: {
    // Coding Style Rules:
    // 1. No arrow functions
    // 2. No class keyword
    'no-restricted-syntax': [
      'error',
      {
        selector: 'ArrowFunctionExpression',
        message: 'Arrow functions are prohibited. Use named function declarations.'
      },
      {
        selector: 'ClassDeclaration',
        message: 'The class keyword is prohibited. Use factory functions or plain objects.'
      },
      {
        selector: 'ClassExpression',
        message: 'The class keyword is prohibited. Use factory functions or plain objects.'
      }
    ],
    // 3. Strict traditional function declarations: function name() {}
    'func-style': ['error', 'declaration', { allowArrowFunctions: false }],
    // 4. No function .bind()
    'no-extra-bind': 'error',
    // 5. No empty catch blocks
    'no-empty': ['error', { allowEmptyCatch: false }],
    // 6. Basic sanity checks
    'no-undef': 'off', // VS Code & browser globals are polyfilled/provided in webview
    'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }]
  },
  overrides: [
    {
      files: ['test/**/*.js', 'scripts/**/*.js'],
      rules: {
        'no-empty': 'off'
      }
    },
    {
      files: ['**/*.cjs'],
      parserOptions: {
        sourceType: 'script'
      }
    }
  ]
};
