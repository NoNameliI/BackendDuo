import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts';
import './styles/index.css';
import { App } from './app/App';
import { startReminders } from './app/reminders';
import { useUi } from './app/store';
import { course } from './content/course';
import { useProgress } from './progress/store';

void Promise.all([useUi.getState().loadSettings(), useProgress.getState().load()]).finally(() => {
  if (course.onboarding && !useProgress.getState().doc.onboarding) useUi.getState().setView('onboarding');
  startReminders();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
