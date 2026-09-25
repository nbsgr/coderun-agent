module.exports = [
  {
    files: ["src/**/*.js", "test/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module"
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ArrowFunctionExpression",
          message: "Arrow functions are prohibited. Use named function declarations."
        },
        {
          selector: "ClassDeclaration",
          message: "The class keyword is prohibited. Use factory functions or plain objects."
        },
        {
          selector: "ClassExpression",
          message: "The class keyword is prohibited. Use factory functions or plain objects."
        }
      ],
      "func-style": ["error", "declaration", { allowArrowFunctions: false }],
      "no-extra-bind": "error",
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }]
    }
  },
  {
    files: ["test/**/*.js", "scripts/**/*.js"],
    rules: {
      "no-empty": "off"
    }
  }
];
