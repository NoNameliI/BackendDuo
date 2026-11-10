import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts';
import './styles/index.css';
import { App } from './app/App';
import { startReminders } from './app/reminders';
import { useUi } from './app/store';
import { restoreAccess } from './content/sealedCourses';
import { useProgress } from './progress/store';

// Sealed courses are registered first, so the saved active course is found among them.
void restoreAccess()
  .catch(() => {})
  .then(() => Promise.all([useUi.getState().loadSettings(), useProgress.getState().load()]))
  .finally(() => {
    startReminders();
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
