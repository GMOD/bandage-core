import eslint from '@eslint/js'
import { defineConfig } from 'eslint/config'
import { importX } from 'eslint-plugin-import-x'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: [
      'eslint.config.mjs',
      'esbuild.mjs',
      'dist/*',
      'scripts/*',
      // build/test config, outside tsconfig.eslint.json's `src` project so
      // typed linting cannot parse them
      'vitest.config.ts',
      'config/**',
      // JBrowse instances the e2e harness creates in the repo root; gitignored,
      // but flat config does not consult .gitignore, so a demo run would
      // otherwise fail lint on hundreds of bundled files
      '.test-jbrowse-*/**',
      // generated Emscripten output, see src/bandage/README.md. The build tree
      // is here too because CMake writes a compiler_depend.ts into it.
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

    settings: {
      react: {
        version: '19',
      },
    },
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylisticTypeChecked,
  ...tseslint.configs.strictTypeChecked,
  importX.flatConfigs.recommended,
  eslintPluginReact.configs.flat.recommended,
  {
    plugins: {
      'react-hooks': eslintPluginReactHooks,
    },
    rules: eslintPluginReactHooks.configs.recommended.rules,
  },
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
          pathGroups: [
            {
              group: 'builtin',
              pattern: 'react',
              position: 'before',
            },
            {
              group: 'external',
              pattern: '@mui/icons-material',
              position: 'after',
            },
          ],

          pathGroupsExcludedImportTypes: ['react'],
        },
      ],

      'one-var': ['error', 'never'],
      'react/no-unescaped-entities': 'off',
      'react/no-is-mounted': 'off',
      'react/prop-types': 'off',
      // Automatic JSX runtime (jsx: react-jsx) — no React import needed.
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',

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
  {
    files: ['test/**'],
    rules: {
      'no-console': 'off',
      // import-x/named can't follow re-exports in @testing-library packages;
      // TypeScript already catches missing named imports at compile time.
      'import-x/named': 'off',
    },
  },
)
