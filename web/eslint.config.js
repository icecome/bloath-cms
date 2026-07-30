import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  // 全局忽略
  { ignores: ['dist', 'public', 'node_modules', 'vite.config.ts', 'postcss.config.js', 'tailwind.config.js'] },

  // 源代码规则
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // 核心 hooks 规则
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // React 19 新增规则，React 18 项目暂不启用
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // tsconfig 已有 noUnusedLocals/noUnusedParameters，此处降为 warn 避免双重报错
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // 允许显式 any 在边界处使用（后续逐步消除）
      '@typescript-eslint/no-explicit-any': 'off',
      // catch 块 cause 属性为 ES2022 特性，Workers/浏览器兼容性待统一
      'preserve-caught-error': 'off',
    },
  },
);
