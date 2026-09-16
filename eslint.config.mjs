// Flat ESLint config (ESLint 9). Kept intentionally minimal at Step 1 — rules
// tighten as apps/api and apps/web gain real code in Steps 3-4.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/.turbo/**'],
  },
  {
    rules: {
      // Extension-seam stubs (Part F) intentionally take unused parameters so their
      // signature matches the eventual real implementation — prefixing with `_`
      // is the documented way to mark that as deliberate, not dead code.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // PRIN-03 is enforced by scripts/assert-no-remote-exec-deps.mjs against the
      // SBOM, not by lint — but a no-restricted-imports backstop costs nothing.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'ssh2',
              message: 'PRIN-03: no SSH client is permitted in this dependency tree.',
            },
            {
              name: 'node-ssh',
              message: 'PRIN-03: no SSH client is permitted in this dependency tree.',
            },
            {
              name: 'child_process',
              message:
                'No user-supplied string may reach a shell (SEC-12). Use the adapter argument-array invocation path.',
            },
          ],
        },
      ],
    },
  },
);
