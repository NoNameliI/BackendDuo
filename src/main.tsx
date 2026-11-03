import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts';
import './styles/index.css';
import { App } from './app/App';
import { useUi } from './app/store';
import { useProgress } from './progress/store';

void Promise.all([useUi.getState().loadSettings(), useProgress.getState().load()]).finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
