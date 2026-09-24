'use client';
import { ERROR_COPY, useErrorReport } from '@/lib/report-error';

// This page replaces the root layout, so none of its fonts, globals.css or
// CSS variables are here. Everything it needs is below: the felt and ivory as
// plain colours, and the phone's own fonts.
const CSS = `
html { color-scheme: dark; }
body {
  margin: 0;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0b2a26;
  color: #f3ecdb;
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
main { box-sizing: border-box; width: 100%; max-width: 28rem; padding: 2.5rem 1.5rem; }
.eyebrow { margin: 0 0 0.5rem; font-size: 12px; font-weight: 500; letter-spacing: 0.3em; text-transform: uppercase; color: rgb(243 236 219 / 0.6); }
h1 { margin: 0 0 0.5rem; font-family: ui-serif, 'New York', Georgia, 'Times New Roman', serif; font-size: 1.875rem; font-weight: 400; line-height: 1.2; }
.line { margin: 0 0 1.5rem; font-size: 0.875rem; line-height: 1.45; color: rgb(230 219 194 / 0.7); }
.actions { display: flex; flex-direction: column; align-items: center; gap: 0.75rem; }
button {
  width: 100%;
  min-height: 52px;
  border: 0;
  border-radius: 999px;
  background: #fbf7ee;
  color: #1a1714;
  font: 500 18px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  cursor: pointer;
  touch-action: manipulation;
}
button:hover { background: #fff; }
button:active { transform: scale(0.97); }
a { padding: 0.25rem 0; font-size: 15px; color: #f3ecdb; text-decoration: underline; text-decoration-color: rgb(230 219 194 / 0.4); text-underline-offset: 4px; }
a:hover { color: #fbf7ee; text-decoration-color: currentColor; }
button:focus-visible, a:focus-visible { outline: 2px solid #d8b45a; outline-offset: 3px; }
`;

/**
 * The last resort, for when the root layout itself breaks and app/error.tsx
 * can't be shown: its own document, the same words, another go and a way home.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useErrorReport(error);
  return (
    <html lang="en">
      <head>
        <title>{`${ERROR_COPY.eyebrow} · Society Mahjong`}</title>
        <meta name="theme-color" content="#0b2a26" />
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <main>
          <p className="eyebrow">{ERROR_COPY.eyebrow}</p>
          <h1>{ERROR_COPY.heading}</h1>
          <p className="line">{ERROR_COPY.line}</p>
          <div className="actions">
            <button type="button" onClick={() => retry()}>
              {ERROR_COPY.retry}
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- the layout is gone, so a plain link and a full page load */}
            <a href="/">{ERROR_COPY.home}</a>
          </div>
        </main>
      </body>
    </html>
  );
}
