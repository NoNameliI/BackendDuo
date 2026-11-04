import { useEffect } from 'react';
import { Button } from '@/ui/Button';
import { PLAYGROUND_SETUP, useSandbox } from './gitSandbox';
import { GitWorkbench } from './GitWorkbench';

/** Free Git sandbox: files, editor, commit graph, status, hosting and a terminal. */
export default function GitSandboxScreen() {
  const useGitSandbox = useSandbox();
  const reset = useGitSandbox((s) => s.reset);
  const started = useGitSandbox((s) => s.version > 0);

  useEffect(() => {
    if (!started) reset(PLAYGROUND_SETUP, '/home/student/site');
  }, [started, reset]);

  return (
    <GitWorkbench
      prefix="git-sandbox"
      actions={
        <Button variant="outline" onClick={() => reset(PLAYGROUND_SETUP, '/home/student/site')}>
          Начать заново
        </Button>
      }
    />
  );
}
