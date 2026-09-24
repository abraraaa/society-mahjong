'use client';
import { ERROR_COPY, useErrorReport } from '@/lib/report-error';

/**
 * What a player sees when a page breaks under the root layout: a plain word
 * that it's not their doing, another go (retry re-fetches the page and renders
 * it again), and a way home. The crash is reported once, quietly.
 *
 * "Back to the start" is a full page load, not a client-side hop: whatever
 * broke in this tab's state is left behind, and it still works when the page
 * that broke is the start page itself.
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useErrorReport(error);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-10">
      <div className="space-y-2">
        <p className="eyebrow">{ERROR_COPY.eyebrow}</p>
        <h1 className="font-display text-3xl">{ERROR_COPY.heading}</h1>
        <p className="text-ivory-200/70 text-sm">{ERROR_COPY.line}</p>
      </div>
      <div className="flex flex-col items-center gap-3">
        <button type="button" className="btn btn-primary btn-block min-h-[52px] text-[18px]" onClick={() => retry()}>
          {ERROR_COPY.retry}
        </button>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load on purpose, see above */}
        <a href="/" className="link-quiet">
          {ERROR_COPY.home}
        </a>
      </div>
    </main>
  );
}
