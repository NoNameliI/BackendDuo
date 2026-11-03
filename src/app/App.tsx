import { useEffect } from 'react';
import { LessonScreen } from '@/features/lesson/LessonScreen';
import { MapScreen } from '@/features/map/MapScreen';
import { OnboardingScreen } from '@/features/onboarding/OnboardingScreen';
import { ProfileScreen } from '@/features/profile/ProfileScreen';
import { Toaster } from '@/ui/toasts';
import { useUi } from './store';
import { TopBar } from './TopBar';
import { applyTheme } from './theme';
import { useResolvedTheme } from './useResolvedTheme';

export function App() {
  const theme = useResolvedTheme();
  const view = useUi((s) => s.view);
  useEffect(() => applyTheme(theme), [theme]);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="min-h-0 flex-1 p-1.5">
        {view === 'onboarding' && <OnboardingScreen />}
        {view === 'map' && <MapScreen />}
        {view === 'lesson' && <LessonScreen />}
        {view === 'profile' && <ProfileScreen />}
      </main>
      <Toaster />
    </div>
  );
}
