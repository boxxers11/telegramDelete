const DEFAULT_PORT = (import.meta.env.VITE_API_PORT as string | undefined) ?? '8001';
const DEFAULT_BASE = `http://127.0.0.1:${DEFAULT_PORT}`;
const DEFAULT_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT ?? 10000);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const normalizeUrl = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  return value.replace(/\/+$/, '');
};

const joinUrl = (base: string, path: string): string => {
  const normalizedBase = normalizeUrl(base);
  if (!normalizedBase) {
    return path;
  }
  if (!path) {
    return normalizedBase;
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${normalizedBase}${path.startsWith('/') ? path : `/${path}`}`;
};

const configuredBaseUrl = normalizeUrl(import.meta.env.VITE_API_BASE_URL as string | undefined);

const resolveBaseUrl = (): string => {
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  if (typeof window === 'undefined') {
    return normalizeUrl(DEFAULT_BASE) ?? DEFAULT_BASE;
  }

  const { protocol, hostname, port } = window.location;
  if (!hostname) {
    return normalizeUrl(DEFAULT_BASE) ?? DEFAULT_BASE;
  }

  const normalizedHost = hostname === 'localhost' ? '127.0.0.1' : hostname;

  const explicitPort =
    (import.meta.env.VITE_API_PORT as string | undefined) ??
    (port && ['5173', '5174', '4173', '4174', '3000', '3001'].includes(port) ? DEFAULT_PORT : DEFAULT_PORT);

  if (!explicitPort || explicitPort === '80' || explicitPort === '443') {
    return normalizeUrl(`${protocol}//${normalizedHost}`) ?? DEFAULT_BASE;
  }

  return normalizeUrl(`${protocol}//${normalizedHost}:${explicitPort}`) ?? DEFAULT_BASE;
};

// Force initial base URL to DEFAULT_BASE to avoid using wrong ports from window.location
let activeBaseUrl = configuredBaseUrl ?? DEFAULT_BASE;
let detectionComplete = Boolean(configuredBaseUrl);
let detectionPromise: Promise<string> | null = null;
const FAILURE_BACKOFF_MS = 5000;
const isDev = import.meta.env.DEV;

let lastFailure: { error: Error; timestamp: number } | null = null;

const recordFailure = (error: unknown): Error => {
  const normalized = error instanceof Error ? error : new Error(String(error));
  lastFailure = { error: normalized, timestamp: Date.now() };
  return normalized;
};

const shouldShortCircuitFailure = (): Error | null => {
  if (!lastFailure) {
    return null;
  }
  if (Date.now() - lastFailure.timestamp < FAILURE_BACKOFF_MS) {
    return lastFailure.error;
  }
  return null;
};

const uniqueCandidates = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((candidate) => {
    const normalized = normalizeUrl(candidate);
    if (!normalized) {
      return;
    }
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
};

const buildCandidateBaseUrls = (): string[] => {
  if (configuredBaseUrl) {
    return [configuredBaseUrl];
  }

  // Always prioritize DEFAULT_BASE first, then other candidates
  const candidates: Array<string | null> = [
    DEFAULT_BASE,
    'http://127.0.0.1:8001',
    'http://localhost:8001'
  ];
  
  // Only add activeBaseUrl if it's different from DEFAULT_BASE to avoid wrong ports
  if (activeBaseUrl && activeBaseUrl !== DEFAULT_BASE && !activeBaseUrl.includes(':8010')) {
    candidates.push(activeBaseUrl);
  }

  const envUrl = normalizeUrl(import.meta.env.VITE_API_BASE_URL as string | undefined);
  if (envUrl) {
    candidates.unshift(envUrl);
  }

  const ports = new Set<string>(['8001', '8000', DEFAULT_PORT].filter(Boolean) as string[]);
  const hosts = new Set<string>(['127.0.0.1', 'localhost']);

  let scheme = 'http:';
  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    if (protocol) {
      scheme = protocol;
    }
    if (hostname) {
      hosts.add(hostname);
      hosts.add(hostname === 'localhost' ? '127.0.0.1' : hostname);
    }
  }

  hosts.forEach((host) => {
    ports.forEach((port) => {
      if (!port || port === '80' || port === '443') {
        candidates.push(`${scheme}//${host}`);
      } else {
        candidates.push(`${scheme}//${host}:${port}`);
      }
    });
  });

  return uniqueCandidates(candidates);
};

const fetchWithTimeout = async (resource: string, options?: RequestInit, timeoutMs: number = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(resource, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(id);
  }
};

const performFetch = (baseUrl: string, path: string, options?: RequestInit) =>
  fetchWithTimeout(joinUrl(baseUrl, path), options);

const isJsonResponse = (response: Response): boolean => {
  if (response.status === 204) {
    return true;
  }
  const contentType = response.headers.get('content-type') ?? '';
  return contentType.toLowerCase().includes('application/json');
};

const detectBaseUrl = async (): Promise<string> => {
  const candidates = buildCandidateBaseUrls();
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      if (isDev) {
        console.debug('[api] probing', candidate);
      }
      const response = await performFetch(candidate, '/accounts', {
        method: 'GET',
        headers: { 'x-api-probe': '1' },
        cache: 'no-store'
      });
      if (!response.ok) {
        response.body?.cancel?.();
        lastError = new Error(`Probe received status ${response.status}`);
        continue;
      }
      if (!isJsonResponse(response)) {
        response.body?.cancel?.();
        lastError = new Error('Probe response is not JSON');
        continue;
      }
      try {
        await response.json();
      } catch (parseError) {
        lastError = parseError;
        continue;
      }
      activeBaseUrl = candidate;
      detectionComplete = true;
      lastFailure = null;
      if (isDev) {
        console.debug('[api] base url detected', candidate);
      }
      return candidate;
    } catch (error) {
      lastError = error;
    }
  }

  detectionComplete = true;
  if (lastError) {
    console.warn('[api] Failed to auto-detect API base URL, falling back to guess:', lastError);
    recordFailure(lastError);
  }
  return activeBaseUrl;
};

const ensureBaseUrl = async (): Promise<string> => {
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }
  // Reset to DEFAULT_BASE if activeBaseUrl has wrong port
  if (activeBaseUrl && activeBaseUrl.includes(':8010')) {
    activeBaseUrl = DEFAULT_BASE;
    detectionComplete = false;
    lastFailure = null;
  }
  if (detectionComplete) {
    return activeBaseUrl;
  }
  if (detectionPromise) {
    return detectionPromise;
  }
  detectionPromise = detectBaseUrl()
    .catch((error) => {
      console.warn('[api] Detection failed:', error);
      // Fallback to DEFAULT_BASE if detection fails
      activeBaseUrl = DEFAULT_BASE;
      return activeBaseUrl;
    })
    .finally(() => {
      detectionPromise = null;
    });
  return detectionPromise;
};

export const getApiBaseUrl = (): string => {
  // Reset if wrong port detected
  if (activeBaseUrl && activeBaseUrl.includes(':8010')) {
    activeBaseUrl = DEFAULT_BASE;
    detectionComplete = false;
  }
  return activeBaseUrl;
};

export const apiUrl = (path: string): string => {
  // Reset if wrong port detected before building URL
  if (activeBaseUrl && activeBaseUrl.includes(':8010')) {
    activeBaseUrl = DEFAULT_BASE;
    detectionComplete = false;
  }
  return joinUrl(activeBaseUrl, path);
};

export const apiFetch = async (path: string, options?: RequestInit): Promise<Response> => {
  const requestInit = options ?? {};
  const method = (requestInit.method ?? 'GET').toString().toUpperCase();
  const allowRetry = SAFE_METHODS.has(method);

  if (!allowRetry) {
    await ensureBaseUrl();
    try {
      const response = await performFetch(activeBaseUrl, path, requestInit);
      lastFailure = null;
      return response;
    } catch (error) {
      throw recordFailure(error);
    }
  }

  const cachedError = shouldShortCircuitFailure();
  if (cachedError) {
    throw cachedError;
  }

  const candidates = buildCandidateBaseUrls();
  let lastError: unknown = null;

  // Reset activeBaseUrl if it has wrong port before making request
  if (activeBaseUrl && activeBaseUrl.includes(':8010')) {
    activeBaseUrl = DEFAULT_BASE;
    detectionComplete = false;
  }

  const targetBaseUrl = configuredBaseUrl || activeBaseUrl;
  try {
    if (isDev) {
      console.debug('[api] request', method, targetBaseUrl, path);
    }
    const response = await performFetch(targetBaseUrl, path, requestInit);
    if (!response.ok) {
      response.body?.cancel?.();
      throw new Error(`HTTP ${response.status}`);
    }
    if (!isJsonResponse(response)) {
      response.body?.cancel?.();
      throw new Error('Received non-JSON response');
    }
    activeBaseUrl = targetBaseUrl;
    detectionComplete = true;
    lastFailure = null;
    return response;
  } catch (error) {
    lastError = error;
  }

  if (lastError instanceof Error) {
    throw recordFailure(lastError);
  }
  throw recordFailure(new Error('Network error while contacting the Telegram Delete API service'));
};
