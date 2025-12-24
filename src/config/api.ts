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

  // In production (not localhost), use the same origin (same domain, same port)
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    // Use same origin - frontend and backend are on the same domain
    return normalizeUrl(`${protocol}//${hostname}${port ? `:${port}` : ''}`) ?? DEFAULT_BASE;
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

// Initialize base URL - use same origin in production, DEFAULT_BASE in development
const getInitialBaseUrl = (): string => {
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    // In production (not localhost), use same origin
    if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
    }
  }
  return DEFAULT_BASE;
};

let activeBaseUrl = getInitialBaseUrl();
let detectionComplete = Boolean(configuredBaseUrl);
let detectionPromise: Promise<string> | null = null;
const INITIAL_BACKOFF_MS = 500; // Very short backoff after first failure (0.5 seconds)
const FAILURE_BACKOFF_MS = 5000; // Longer backoff after multiple failures
const MAX_CONSECUTIVE_FAILURES = 2; // Reduced to activate backoff faster
const isDev = import.meta.env.DEV;

let lastFailure: { error: Error; timestamp: number } | null = null;
let consecutiveFailures = 0;
let firstFailureTime: number | null = null; // Track when first failure occurred

const recordFailure = (error: unknown): Error => {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const now = Date.now();
  lastFailure = { error: normalized, timestamp: now };
  consecutiveFailures += 1;
  
  // Record first failure time for faster backoff detection
  if (consecutiveFailures === 1) {
    firstFailureTime = now;
  }
  
  return normalized;
};

const recordSuccess = () => {
  lastFailure = null;
  consecutiveFailures = 0;
  firstFailureTime = null;
};

const shouldShortCircuitFailure = (): Error | null => {
  if (!lastFailure) {
    return null;
  }
  
  const now = Date.now();
  const timeSinceLastFailure = now - lastFailure.timestamp;
  
  // After first failure, use very short backoff to prevent immediate retries
  // Use firstFailureTime for more accurate timing
  if (consecutiveFailures >= 1 && firstFailureTime) {
    const timeSinceFirstFailure = now - firstFailureTime;
    if (timeSinceFirstFailure < INITIAL_BACKOFF_MS) {
      // Return a silent error that won't trigger browser console messages
      // This prevents fetch calls and browser "Fetch failed loading" messages
      return new Error('Backend unavailable');
    }
  }
  
  // After too many consecutive failures, stop trying for longer
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    const extendedBackoff = FAILURE_BACKOFF_MS * (consecutiveFailures - 1);
    if (timeSinceLastFailure < extendedBackoff) {
      // Return a silent error that won't trigger browser console messages
      // This prevents fetch calls and browser "Fetch failed loading" messages
      return new Error('Backend unavailable');
    }
  } else if (timeSinceLastFailure < FAILURE_BACKOFF_MS) {
    // Return a silent error that won't trigger browser console messages
    // This prevents fetch calls and browser "Fetch failed loading" messages
    return new Error('Backend unavailable');
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
  // Check for short-circuit before attempting detection
  const cachedError = shouldShortCircuitFailure();
  if (cachedError) {
    // If backend is known to be unavailable, skip detection
    return activeBaseUrl;
  }

  const candidates = buildCandidateBaseUrls();
  let lastError: unknown = null;

  for (const candidate of candidates) {
    // Check for short-circuit before each probe
    const probeError = shouldShortCircuitFailure();
    if (probeError) {
      // Skip remaining probes if backend is unavailable
      break;
    }

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

// Export shouldShortCircuitFailure for use in other modules
export { shouldShortCircuitFailure };

export const apiFetch = async (path: string, options?: RequestInit): Promise<Response> => {
  const requestInit = options ?? {};
  const method = (requestInit.method ?? 'GET').toString().toUpperCase();
  const allowRetry = SAFE_METHODS.has(method);

  // Check for short-circuit BEFORE making any fetch calls
  // This prevents "Fetch failed loading" messages from the browser
  const cachedError = shouldShortCircuitFailure();
  if (cachedError) {
    // Return a rejected promise immediately without making any fetch calls
    // This prevents browser console errors
    return Promise.reject(cachedError);
  }

  if (!allowRetry) {
    // Check for short-circuit again before ensureBaseUrl (which might make fetch calls)
    const preCheckError = shouldShortCircuitFailure();
    if (preCheckError) {
      return Promise.reject(preCheckError);
    }
    
    await ensureBaseUrl();
    
    // Check for short-circuit again after ensureBaseUrl
    const postCheckError = shouldShortCircuitFailure();
    if (postCheckError) {
      return Promise.reject(postCheckError);
    }
    
    try {
      const response = await performFetch(activeBaseUrl, path, requestInit);
      recordSuccess(); // Reset failure counter on success
      return response;
    } catch (error) {
      throw recordFailure(error);
    }
  }

  const candidates = buildCandidateBaseUrls();
  let lastError: unknown = null;

  // Reset activeBaseUrl if it has wrong port before making request
  if (activeBaseUrl && activeBaseUrl.includes(':8010')) {
    activeBaseUrl = DEFAULT_BASE;
    detectionComplete = false;
  }

  const targetBaseUrl = configuredBaseUrl || activeBaseUrl;
  
  // Check for short-circuit again before making the actual fetch call
  const finalCheckError = shouldShortCircuitFailure();
  if (finalCheckError) {
    return Promise.reject(finalCheckError);
  }
  
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
    recordSuccess(); // Reset failure counter on success
    return response;
  } catch (error) {
    lastError = error;
  }

  if (lastError instanceof Error) {
    throw recordFailure(lastError);
  }
  throw recordFailure(new Error('Network error while contacting the Telegram Delete API service'));
};
