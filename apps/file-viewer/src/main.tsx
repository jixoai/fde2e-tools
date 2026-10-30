/**
 * 应用入口 —— src/main.tsx
 *
 * 纯静态预览站，零全局 Provider：布局壳（App）自行解析 URL 契约、拉取字节。
 * 迁移归一（2026-10-30 并入 fde2e-tools）：深色翻面改走 shared 的
 * applySystemDark（与全仓工具族同款；原仓 index.html 内联脚本退役——
 * 行为等价：React 首帧前挂好 .dark，且额外支持系统偏好实时翻面）。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applySystemDark } from '@fde2e-tools/shared';
import App from './App';
import './app.css';

/* 官方主题深色路径＝.dark 类：系统深色时挂类激活（见 shared/src/theme.ts） */
applySystemDark();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
