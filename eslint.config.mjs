import eslint from '@eslint/js'
import { defineConfig } from 'eslint/config'
import { importX } from 'eslint-plugin-import-x'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: [
      'eslint.config.mjs',
      'dist/*',
      'build.mjs',
      'scripts/*',
      // build/test config, outside tsconfig.eslint.json's `src` project so
      // typed linting cannot parse them
      'vitest.config.ts',
      'config/**',
      '.claude/**',
      // generated Emscripten output, see src/bandage/README.md.
      // The build tree is here too because CMake writes a compiler_depend.ts
      // into it.
      'src/bandage/bandage-layout.js',
      '.wasm-build/**',
      // vendored OGDF (vendor/README.md). Nothing in the committed sources is
      // JS or TS, but its own build tree lands here and CMake writes the same
      // compiler_depend.ts into that one — gitignored, and per the note above
      // flat config does not read .gitignore.
      'vendor/**',
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylisticTypeChecked,
  ...tseslint.configs.strictTypeChecked,
  importX.flatConfigs.recommended,
  {
    rules: {
      'no-restricted-globals': ['error', 'Buffer'],
      'no-empty': 'off',
      'no-console': [
        'warn',
        {
          allow: ['error', 'warn'],
        },
      ],
      'no-underscore-dangle': 'off',
      curly: 'error',
      semi: ['error', 'never'],
      'spaced-comment': [
        'error',
        'always',
        {
          markers: ['/'],
        },
      ],

      'import-x/no-unresolved': 'off',
      'import-x/order': [
        'error',
        {
          named: true,
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
          },
          groups: [
            'builtin',
            ['external', 'internal'],
            ['parent', 'sibling', 'index', 'object'],
            'type',
          ],
        },
      ],

      'one-var': ['error', 'never'],

      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          ignoreRestSiblings: true,
          caughtErrors: 'none',
        },
      ],
    },
  },
)
