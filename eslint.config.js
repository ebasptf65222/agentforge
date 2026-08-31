import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import prettierConfig from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  // 全局忽略
  {
    ignores: [
      'dist/**',
      'dist2/**',
      'out/**',
      'node_modules/**',
      'resources/**',
      // 文档与设计产物（含压缩的第三方 js，非源码）
      'docs/**',
      '.qoder/**',
      '.trae/**',
      '**/*.min.js',
      // 渲染进程内置的第三方打包产物（pdf/pptx/xlsx/docx worker 等）
      '**/public/vendor/**',
    ],
  },

  // JS 基础推荐规则
  js.configs.recommended,

  // TypeScript 严格规则
  ...tseslint.configs.strict,

  // Vue 推荐规则（包含正确的 vue-eslint-parser 配置）
  ...pluginVue.configs['flat/recommended'],

  // Vue 文件使用 TypeScript 解析器，并注入浏览器全局变量
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
      },
    },
  },

  // 渲染进程 TS 文件注入浏览器全局变量
  {
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // TypeScript + Vue 自定义规则
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.vue'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
      'no-console': ['warn', { allow: ['log', 'info', 'warn', 'error'] }],
    },
  },

  // Prettier 兼容（必须放最后）
  prettierConfig,
)
