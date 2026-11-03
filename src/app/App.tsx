import { useEffect } from 'react';
import { LessonScreen } from '@/features/lesson/LessonScreen';
import { TopBar } from './TopBar';
import { applyTheme } from './theme';
import { useResolvedTheme } from './useResolvedTheme';

export function App() {
  const theme = useResolvedTheme();
  useEffect(() => applyTheme(theme), [theme]);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="min-h-0 flex-1 p-1.5">
        <LessonScreen />
      </main>
    </div>
  );
}
