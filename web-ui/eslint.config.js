// ESLint 基线（flat config）：只开"真错误"级别规则，不做风格强制（交给 Prettier 类工具另行引入）。
// 目标是兜住未定义变量、未使用组件、v-for key 缺失这类实际缺陷，不追求零告警。
import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

export default [
  { ignores: ['node_modules/**', '../agent-core/public/**', 'public/fonts/**'] },
  js.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      // 部分 <script setup lang="ts"> 组件需要 TS 解析（TS 是 JS 超集，纯 JS 文件不受影响）
      parserOptions: { parser: '@typescript-eslint/parser' },
    },
  },
  {
    rules: {
      // —— 降级为警告：存量代码量大，风格统一交给后续格式化 ——
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-indent': 'off',
      'vue/attributes-order': 'off',
      'vue/order-in-components': 'off',
      'vue/require-default-prop': 'off',
      'vue/require-explicit-emits': 'off',
      'vue/multi-word-component-names': 'off', // Gallery/Sidebar/Toast 等历史命名，改名牵动全部引用
      'vue/no-mutating-props': 'warn',          // 存量反模式（LibraryItemCard/MomentCard 等），待后续重构
      'vue/no-v-html': 'warn', // 项目有受控的 v-html（渲染后端返回内容），保持可见提醒
      'no-empty': ['error', { allowEmptyCatch: true }], // 空 catch 是本库既定的"忽略失败"手法
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-undef': 'error',
      'no-dupe-keys': 'error',
    },
  },
]
