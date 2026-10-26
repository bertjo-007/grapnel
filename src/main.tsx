import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './ui/styles/tokens.css';
import './ui/styles/base.css';
import './ui/styles/components.css';
import './ui/styles/shell.css';
import './ui/styles/pages.css';
import './ui/styles/study.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { registerServiceWorker, requestPersistence } from './ui/sw';
import { installViewportVars } from './ui/viewport';

installViewportVars();
registerServiceWorker();
// Daten sollen nicht bei Platzmangel verschwinden. Installierte Apps bekommen das meist sofort.
void requestPersistence().catch(() => false);
if (import.meta.env.DEV) void import('./dev/seed').then((m) => m.seedDevData()).catch((e) => console.error(e));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
