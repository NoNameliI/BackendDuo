import { lazy, Suspense, useEffect } from 'react';
import { setWindowTheme } from '@/platform';
import { HubScreen } from '@/features/hub/HubScreen';
import { LessonScreen } from '@/features/lesson/LessonScreen';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { MapScreen } from '@/features/map/MapScreen';
import { OnboardingScreen } from '@/features/onboarding/OnboardingScreen';
import { ProfileScreen } from '@/features/profile/ProfileScreen';
import { Toaster } from '@/ui/toasts';
import { useHotkeys } from './hotkeys';
import { useUi } from './store';
import { TopBar } from './TopBar';
import { applyTheme } from './theme';
import { useResolvedTheme } from './useResolvedTheme';

const GitSandboxScreen = lazy(() => import('@/features/git/GitSandboxScreen'));
const DrillScreen = lazy(() => import('@/features/drill/DrillScreen'));

// Development only: lets a local run register the neutral fixture course (dropped from production builds).
if (import.meta.env.DEV) void import('@/features/drill/devFixture');

export function App() {
  const theme = useResolvedTheme();
  const view = useUi((s) => s.view);
  useHotkeys({
    'Ctrl+K': () => {
      const ui = useUi.getState();
      if (ui.view !== 'onboarding') ui.setPaletteOpen(!ui.paletteOpen);
    },
  }, { inModal: true });
  useEffect(() => {
    applyTheme(theme);
    void setWindowTheme(theme);
  }, [theme]);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="min-h-0 flex-1 p-1.5">
        {view === 'hub' && <HubScreen />}
        {view === 'onboarding' && <OnboardingScreen />}
        {view === 'map' && <MapScreen />}
        {view === 'lesson' && <LessonScreen />}
        {view === 'profile' && <ProfileScreen />}
        {view === 'drill' && (
          <Suspense fallback={null}>
            <DrillScreen />
          </Suspense>
        )}
        {view === 'git-sandbox' && (
          <Suspense fallback={null}>
            <GitSandboxScreen />
          </Suspense>
        )}
      </main>
      <CommandPalette />
      <Toaster />
    </div>
  );
}
