import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'gnc_config', 'src/three-webgpu.d.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Vite does not run the React Compiler in this application. Keep the
      // stable Rules of Hooks and dependency checks, but do not report
      // compiler-eligibility diagnostics as release-blocking lint failures.
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  // The entry point mounts the router without exports; telemetry and preview
  // modules export pure helpers for focused unit tests. MagicRings bridges an
  // imperative WebGL renderer and therefore owns a DOM ref outside render.
  {
    files: ['src/main.tsx', 'src/components/MagicRings.ts', 'src/pages/workspace/GncTelemetryCharts.tsx', 'src/pages/agent/WorkspaceFilePreviewPanel.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/refs': 'off',
    },
  },
])
