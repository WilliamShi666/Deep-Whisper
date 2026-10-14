import nextTs from 'eslint-config-next/typescript';
import nextVitals from 'eslint-config-next/core-web-vitals';
import importPlugin from 'eslint-plugin-import';
import { defineConfig, globalIgnores } from 'eslint/config';

const syntaxRules = [
  {
    selector: 'JSXOpeningElement[name.name="head"]',
    message:
      '禁止使用 head 标签，优先使用 metadata。三方 CSS、字体等资源可以在 globals.css 中顶部通过 @import 引入或者使用 next/font；preload, preconnect, dns-prefetch 通过 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入；json-ld 可阅读 https://nextjs.org/docs/app/guides/json-ld',
  },
];

const nextConfigRestrictedSyntaxRules = [
  {
    selector:
      'Property[key.name=/^(root|outputFileTracingRoot)$/] > Literal[value=/^\\//]',
    message:
      '禁止在 next.config 中写死绝对路径，请改用 path.resolve(__dirname, ...)、import.meta.dirname 或 process.cwd() 动态拼接。',
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: { import: importPlugin },
    rules: {
      'import/no-cycle': ['error', { ignoreExternal: true }],
      'react-hooks/set-state-in-effect': 'off',
      'no-restricted-syntax': ['error', ...syntaxRules],
    },
  },
  {
    files: ['next.config.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...nextConfigRestrictedSyntaxRules],
    },
  },
  {
    // This Docker launcher is deliberately CommonJS and loads a local JSON profile.
    files: ['scripts/loopback-docker-args.cjs', 'tests/helpers/server-only.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    // 隔离构建产物：`NEXT_DIST_DIR=.next-xxx next dev|build` 会生成与 `.next` 平级的缓存目录
    // （英文落地页截图 / e2e / 任何需要独立构建缓存的工作都会这么干），项目约定一律命名 `.next-*`。
    // 不忽略它们时 `eslint . --quiet` 会把编译产物整目录扫进来（本轮实测 704–854 条
    // `no-require-imports` 等 error，把 `pnpm lint:build` 对全队打红，t29/t32/t33/t34/t35 各自撞到）；
    // 修法是覆盖任意隔离 distDir，而不是逐个补目录名。
    '.next-*/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Build artifacts:
    'server.js',
    'dist/**',
    '.local/**',
    // Local agent scratch and evidence artifacts (never committed):
    '.codex-p3-stage/**',
    // GitNexus 索引产物：由本地 `gitnexus analyze` 生成（已被 .git/info/exclude 排除），
    // 但它自带一个 CommonJS 启动器，会被 eslint 扫到并报 no-require-imports。
    '.gitnexus/**',
    // Script files (CommonJS):
    'scripts/**/*.js',
  ]),
]);

export default eslintConfig;
