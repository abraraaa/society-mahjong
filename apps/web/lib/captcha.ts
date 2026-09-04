'use client';

/**
 * hCaptcha, invisible mode, for the one call that creates an account: the
 * anonymous sign-in behind the name gate. Supabase verifies the token with the
 * secret configured on the project (Authentication → Bot protection), so a
 * script cannot mint guests by hammering the sign-in endpoint.
 *
 * The site key is public by design; it can be overridden per environment.
 */
export const HCAPTCHA_SITEKEY = process.env.NEXT_PUBLIC_HCAPTCHA_SITEKEY || '63540b4a-1f1a-4b62-878a-03f89d9e499e';

interface HCaptchaApi {
  render(container: HTMLElement, config: Record<string, unknown>): string;
  execute(widgetId: string, opts: { async: true }): Promise<{ response: string }>;
  remove(widgetId: string): void;
  reset(widgetId: string): void;
}

declare global {
  interface Window {
    hcaptcha?: HCaptchaApi;
    __hcaptchaReady?: () => void;
  }
}

let loading: Promise<HCaptchaApi> | null = null;

/** Load the hCaptcha script once and resolve with its API. */
export function loadHcaptcha(): Promise<HCaptchaApi> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.hcaptcha) return Promise.resolve(window.hcaptcha);
  if (loading) return loading;
  loading = new Promise<HCaptchaApi>((resolve, reject) => {
    window.__hcaptchaReady = () => (window.hcaptcha ? resolve(window.hcaptcha) : reject(new Error('hcaptcha did not initialise')));
    const s = document.createElement('script');
    s.src = 'https://js.hcaptcha.com/1/api.js?render=explicit&onload=__hcaptchaReady';
    s.async = true;
    s.defer = true;
    s.onerror = () => {
      loading = null;
      reject(new Error('could not load hCaptcha'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Run an invisible challenge inside `container` and return the token. Most
 * visitors never see anything; a suspicious one gets the puzzle.
 */
export async function solveCaptcha(container: HTMLElement): Promise<string> {
  const api = await loadHcaptcha();
  const id = api.render(container, { sitekey: HCAPTCHA_SITEKEY, size: 'invisible', theme: 'dark' });
  try {
    const { response } = await api.execute(id, { async: true });
    if (!response) throw new Error('captcha gave no token');
    return response;
  } finally {
    api.remove(id);
  }
}
