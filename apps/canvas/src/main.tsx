import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applySystemDark } from '@fde2e-tools/shared';
import App from './App';
import './app.css';

applySystemDark();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
