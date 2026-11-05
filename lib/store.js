// Storage layout shared by the side panel and the service worker.
// Keep the key format in sync with content/bridge.js.
export const configKey = (origin) => `fso:config:${origin}`;
export const capturedKey = (origin) => `fso:captured:${origin}`;
export const settingsKey = 'fso:settings';

export const enabledByDefault = (origin) => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
};

export const originOf = (url) => {
  try {
    const { protocol, origin } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? origin : null;
  } catch {
    return null;
  }
};

export async function loadConfig(origin) {
  const stored = (await chrome.storage.local.get(configKey(origin)))[configKey(origin)];
  return {
    enabled: stored?.enabled ?? enabledByDefault(origin),
    overrides: stored?.overrides ?? {},
    updatedAt: stored?.updatedAt ?? 0,
  };
}

export async function saveConfig(origin, config) {
  await chrome.storage.local.set({ [configKey(origin)]: { ...config, updatedAt: Date.now() } });
}

export async function loadCaptured(origin) {
  return (await chrome.storage.local.get(capturedKey(origin)))[capturedKey(origin)] ?? null;
}

export const activeOverrideCount = (config) =>
  config.enabled ? Object.keys(config.overrides).length : 0;

// Global settings. `apiUrls` empty = auto-detect any `…/api/v1/identities|flags/` response.
export async function loadSettings() {
  const stored = (await chrome.storage.local.get(settingsKey))[settingsKey];
  return { apiUrls: stored?.apiUrls ?? [] };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ [settingsKey]: settings });
}

// Normalises a Flagsmith API base URL to the form the SDK uses: `https://host/api/v1/`.
export function normalizeApiUrl(input) {
  const url = new URL(input.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) URLs');
  const path = url.pathname.replace(/(identities|flags)\/?$/, '');
  return url.origin + (path.endsWith('/') ? path : `${path}/`);
}
