export default [
  { ignores: ["dist/**", "data/**"] },
  {
    files: ["**/*.{js,jsx,mjs}"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      "no-constant-binary-expression": "error",
      "no-dupe-args": "error",
      "no-dupe-keys": "error",
      "no-empty-pattern": "error",
      "no-import-assign": "error",
      "no-unreachable": "error",
      "valid-typeof": "error",
    },
  },
];
