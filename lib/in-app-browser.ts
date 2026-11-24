/**
 * In-app browsers — the page opened from a link inside Instagram, Facebook,
 * Messenger, TikTok, Snapchat… — are embedded WebViews, and Google refuses
 * to sign anyone in from those ("Accès bloqué : disallowed_useragent").
 * Students reaching MedArt from a post or a story landed on that error page
 * after tapping "Continuer avec Google".
 *
 * Detection is by user agent, and deliberately narrow: the apps' own markers,
 * plus Android's generic WebView flag ("; wv)"). An iOS WebView without a
 * marker is left alone — it can't be told apart from a home-screen web app,
 * where Google sign-in works.
 */
export interface InAppBrowser {
  /** Shown to the student ("Instagram"), or null for an unnamed app's WebView. */
  app: string | null;
  android: boolean;
  ios: boolean;
  /** The app is known to hand intent:// links to Android (opens the real browser). */
  canOpenExternally: boolean;
}

const APPS: ReadonlyArray<[RegExp, string, boolean]> = [
  [/Instagram/i, "Instagram", true],
  [/Messenger|Orca-Android|FB_IAB\/MESSENGER/i, "Messenger", true],
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i, "Facebook", true],
  [/musical_ly|BytedanceWebview|Bytedance|TikTok|trill_/i, "TikTok", false],
  [/Snapchat/i, "Snapchat", false],
  [/LinkedInApp/i, "LinkedIn", false],
  [/\bLine\//i, "LINE", false],
  [/MicroMessenger/i, "WeChat", false],
];

export function detectInAppBrowser(userAgent: string): InAppBrowser | null {
  const android = /Android/i.test(userAgent);
  const ios = /iPhone|iPad|iPod/i.test(userAgent);
  for (const [pattern, app, external] of APPS) {
    if (pattern.test(userAgent)) return { app, android, ios, canOpenExternally: external && android };
  }
  if (android && /;\s*wv\)/.test(userAgent)) return { app: null, android, ios, canOpenExternally: false };
  return null;
}

/** An Android intent that opens this same page in the phone's default browser. */
export function externalBrowserIntent(href: string): string {
  const url = new URL(href);
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;S.browser_fallback_url=${encodeURIComponent(url.href)};end`;
}
