import { getApiBaseUrl } from './api';

const rewriteUrl = (url: string, base: string): string => {
  if (!url) {
    return url;
  }

  // Force correct port - never use 8010
  const DEFAULT_BASE = 'http://127.0.0.1:8001';
  if (base && (base.includes(':8010') || base.includes('localhost:8010'))) {
    base = DEFAULT_BASE;
  }
  
  // Also check and fix the URL itself if it contains 8010
  if (url.includes(':8010') || url.includes('localhost:8010')) {
    url = url.replace(/:8010/g, ':8001').replace(/localhost:8010/g, '127.0.0.1:8001');
  }

  if (url.startsWith('//')) {
    const normalized = `${window.location.protocol}${url}`;
    return rewriteUrl(normalized, base);
  }

  if (url.startsWith('/')) {
    return `${base}${url}`;
  }

  const candidates = [
    /^https?:\/\/127\.0\.0\.1:8001/i,
    /^https?:\/\/localhost:8001/i,
    /^https?:\/\/127\.0\.0\.1:8000/i,
    /^https?:\/\/localhost:8000/i,
    /^https?:\/\/127\.0\.0\.1:5173/i,
    /^https?:\/\/127\.0\.0\.1:5174/i,
    /^https?:\/\/127\.0\.0\.1:5175/i,
    /^https?:\/\/localhost:5173/i,
    /^https?:\/\/localhost:5174/i,
    /^https?:\/\/localhost:5175/i
  ];

  let rewritten = url;
  for (const pattern of candidates) {
    if (pattern.test(rewritten)) {
      rewritten = rewritten.replace(pattern, base);
      break;
    }
  }

  return rewritten;
};

const cloneRequestWithUrl = (request: Request, url: string): Request => {
  const cloned = request.clone();
  const init: RequestInit = {
    method: cloned.method,
    headers: cloned.headers,
    mode: cloned.mode,
    credentials: cloned.credentials,
    cache: cloned.cache,
    redirect: cloned.redirect,
    referrer: cloned.referrer,
    referrerPolicy: cloned.referrerPolicy,
    integrity: cloned.integrity,
    keepalive: cloned.keepalive,
    signal: cloned.signal
  };

  if (cloned.body !== null && cloned.method !== 'GET' && cloned.method !== 'HEAD') {
    init.body = cloned.body as unknown as BodyInit;
  }

  return new Request(url, init);
};

export const installApiShims = (): void => {
  if (typeof window === 'undefined' || typeof globalThis.fetch !== 'function') {
    return;
  }

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    // Get fresh base URL on each call to handle dynamic port changes
    const base = getApiBaseUrl();
    if (typeof input === 'string') {
      return originalFetch(rewriteUrl(input, base), init);
    }
    if (input instanceof URL) {
      const rewritten = new URL(input.toString());
      rewritten.href = rewriteUrl(rewritten.href, base);
      return originalFetch(rewritten, init);
    }
    if (input instanceof Request) {
      const rewrittenRequest = cloneRequestWithUrl(input, rewriteUrl(input.url, base));
      return originalFetch(rewrittenRequest, init);
    }
    return originalFetch(input, init);
  };

  if (typeof window.EventSource === 'function') {
    const OriginalEventSource = window.EventSource;
    class PatchedEventSource extends OriginalEventSource {
      constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
        // Get fresh base URL on each EventSource creation
        const base = getApiBaseUrl();
        const originalUrl = typeof url === 'string' ? url : url.toString();
        super(rewriteUrl(originalUrl, base), eventSourceInitDict);
      }
    }
    window.EventSource = PatchedEventSource as typeof EventSource;
  }
};
