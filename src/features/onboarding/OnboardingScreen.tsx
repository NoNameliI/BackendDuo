import { useState } from 'react';
import { useUi } from '@/app/store';
import { useCourse } from '@/app/useCourse';
import { useProgress } from '@/progress/store';
import { useFocusHeading } from '@/ui/useFocusHeading';
import { ApiBeginnerFlow } from './ApiBeginnerFlow';
import { BeginnerFlow } from './BeginnerFlow';
import { BrokerBeginnerFlow } from './BrokerBeginnerFlow';
import { GitBeginnerFlow } from './GitBeginnerFlow';
import { PlacementFlow } from './PlacementFlow';

type Path = 'beginner' | 'experienced';

export function OnboardingScreen() {
  const course = useCourse();
  const data = course.onboarding;
  const [path, setPath] = useState<Path | null>(null);
  const rootRef = useFocusHeading<HTMLDivElement>(path);
  const setView = useUi((s) => s.setView);
  const { completeOnboarding, passLessons } = useProgress();

  if (!data) return null;

  const finish = (chosen: Path, unlocks: string[] = []) => {
    passLessons(course.id, unlocks);
    completeOnboarding(course.id, chosen);
    setView('map');
  };

  return (
    <div className="h-full overflow-auto">
      <div ref={rootRef} className="mx-auto max-w-4xl px-6 py-10">
        {path === null && (
          <section className="animate-rise">
            <h1 className="text-[32px] font-semibold leading-tight tracking-tight">{data.welcome.title}</h1>
            <p className="mt-3 max-w-2xl text-[16px] text-dim">{data.welcome.subtitle}</p>
            <div className="mt-8 grid gap-3 md:grid-cols-2">
              <PathCard glyph="00" title={data.welcome.beginner.title} text={data.welcome.beginner.text} onClick={() => setPath('beginner')} />
              {course.placement && (
                <PathCard glyph={course.engine === 'git' ? 'GIT' : course.engine === 'api' ? 'API' : course.engine === 'broker' ? 'MQ' : 'SQL'} title={data.welcome.experienced.title} text={data.welcome.experienced.text} onClick={() => setPath('experienced')} />
              )}
            </div>
          </section>
        )}
        {path === 'beginner' &&
          (data.kind === 'git' ? (
            <GitBeginnerFlow data={data} onFinish={() => finish('beginner')} />
          ) : data.kind === 'api' ? (
            <ApiBeginnerFlow data={data} onFinish={() => finish('beginner')} />
          ) : data.kind === 'broker' ? (
            <BrokerBeginnerFlow data={data} onFinish={() => finish('beginner')} />
          ) : (
            <BeginnerFlow data={data} onFinish={() => finish('beginner')} />
          ))}
        {path === 'experienced' && course.placement && (
          <PlacementFlow placement={course.placement} onFinish={(unlocks) => finish('experienced', unlocks)} />
        )}
      </div>
    </div>
  );
}

function PathCard({ glyph, title, text, onClick }: { glyph: string; title: string; text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-start gap-3 rounded-md border border-line bg-panel p-5 text-left transition hover:border-amber/60 hover:bg-raised"
    >
      <span className="grid h-10 w-10 place-items-center rounded border border-line-strong font-mono text-[12px] font-semibold text-amber transition group-hover:border-amber">
        {glyph}
      </span>
      <span className="text-[18px] font-semibold">{title}</span>
      <span className="text-[14px] leading-relaxed text-dim">{text}</span>
      <span className="mt-auto pt-2 font-mono text-[12px] text-amber">Выбрать →</span>
    </button>
  );
}
