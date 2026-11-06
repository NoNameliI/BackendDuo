import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts';
import './styles/index.css';
import { App } from './app/App';
import { startReminders } from './app/reminders';
import { useUi } from './app/store';
import { restoreAccess } from './content/sealedCourses';
import { useProgress } from './progress/store';

void Promise.all([useUi.getState().loadSettings(), useProgress.getState().load(), restoreAccess().catch(() => {})]).finally(() => {
  startReminders();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
