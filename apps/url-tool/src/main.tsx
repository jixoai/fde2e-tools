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
