import globals from 'globals';
export default [
  { ignores: ['node_modules/**', 'dist/**', 'vendor/**', 'test-results/**', 'playwright-report/**', 'precache-manifest.js'] },
  { files: ['**/*.js'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser, ...globals.node, ...globals.worker } },
    rules: { 'no-undef': 'error', 'no-dupe-args': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error', 'no-constant-condition': 'error' } }
];
