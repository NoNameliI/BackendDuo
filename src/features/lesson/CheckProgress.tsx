/** What a long check is doing now, beside the check button. Always mounted, so screen readers announce every change. */
export function CheckProgress({ checking, progress }: { checking: boolean; progress: string }) {
  const text = checking ? progress : '';
  return (
    <span role="status" aria-live="polite" className="min-w-0 max-w-[16rem] truncate text-[12px] text-amber" title={text || undefined}>
      {text}
    </span>
  );
}
