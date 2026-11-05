// Runs in the page's MAIN world at document_start, before the app bundle captures
// `window.fetch`. Intercepts Flagsmith flag responses, reports the original flags to
// the extension and returns a response with the local overrides applied.
(() => {
  const TAG = '__flagsmith_override__';
  // Auto-detection when no API URL is configured: any `…/api/v1/identities/` or `…/api/v1/flags/`.
  const AUTO_DETECT_PATH = /\/api\/v1\/(identities|flags)\/?$/;
  // Endpoints the Flagsmith JS SDK appends to its `api` base URL.
  const SDK_ENDPOINT = /^(identities|flags)\/?$/;
  const CONFIG_WAIT_MS = 1000;

  let config = null;
  let resolveConfig;
  const configReady = new Promise((resolve) => (resolveConfig = resolve));

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.tag !== TAG || event.data.type !== 'config') return;
    config = event.data.config;
    resolveConfig();
  });
  window.postMessage({ tag: TAG, type: 'hello' }, '*');

  const requestUrl = (input) =>
    typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url ?? '';

  // Returns the Flagsmith API base URL the request belongs to, or null.
  const flagsmithApiBase = (url, apiUrls) => {
    let absolute;
    try {
      absolute = new URL(url, location.href);
    } catch {
      return null;
    }
    const withoutQuery = absolute.origin + absolute.pathname;
    if (apiUrls.length > 0) {
      return (
        apiUrls.find(
          (base) => withoutQuery.startsWith(base) && SDK_ENDPOINT.test(withoutQuery.slice(base.length)),
        ) ?? null
      );
    }
    const match = absolute.pathname.match(AUTO_DETECT_PATH);
    return match ? withoutQuery.slice(0, withoutQuery.length - match[0].length) + '/api/v1/' : null;
  };

  const isFlagList = (flags) =>
    Array.isArray(flags) && flags.every((flag) => typeof flag?.feature?.name === 'string');

  const syntheticFlag = (name, override, index) => ({
    id: null,
    feature: {
      id: -(index + 1),
      name,
      created_date: null,
      description: null,
      initial_value: null,
      default_enabled: null,
      type: 'STANDARD',
    },
    feature_state_value: override.value ?? null,
    environment: null,
    identity: null,
    feature_segment: null,
    enabled: override.enabled ?? false,
  });

  const applyOverrides = (flags, overrides) => {
    const patched = flags.map((flag) => {
      const override = overrides[flag.feature.name];
      if (!override) return flag;
      return {
        ...flag,
        ...('enabled' in override && { enabled: override.enabled }),
        ...('value' in override && { feature_state_value: override.value }),
      };
    });
    const known = new Set(flags.map((flag) => flag.feature.name));
    Object.entries(overrides)
      .filter(([name]) => !known.has(name))
      .forEach(([name, override], index) => patched.push(syntheticFlag(name, override, index)));
    return patched;
  };

  const originalFetch = window.fetch;

  window.fetch = async function (input, init) {
    const response = await originalFetch.call(window, input, init);
    if (!response.ok) return response;
    // The config carries the configured API URLs, so it must be known before matching.
    // It arrives within milliseconds of page load, long before the app requests flags.
    if (!config) {
      await Promise.race([configReady, new Promise((resolve) => setTimeout(resolve, CONFIG_WAIT_MS))]);
    }
    const url = requestUrl(input);
    const apiBase = flagsmithApiBase(url, config?.apiUrls ?? []);
    if (!apiBase) return response;

    let body;
    try {
      body = await response.clone().json();
    } catch {
      return response;
    }
    const flags = Array.isArray(body) ? body : body?.flags;
    if (!isFlagList(flags)) return response;

    window.postMessage(
      {
        tag: TAG,
        type: 'captured',
        payload: {
          url,
          apiBase,
          identifier: Array.isArray(body) ? null : body.identifier ?? null,
          at: Date.now(),
          flags: flags.map((flag) => ({
            name: flag.feature.name,
            enabled: flag.enabled,
            value: flag.feature_state_value,
          })),
        },
      },
      '*',
    );

    if (!config?.enabled || Object.keys(config.overrides).length === 0) return response;

    const patchedFlags = applyOverrides(flags, config.overrides);
    const patchedBody = Array.isArray(body) ? patchedFlags : { ...body, flags: patchedFlags };
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('x-flagsmith-override', String(Object.keys(config.overrides).length));
    return new Response(JSON.stringify(patchedBody), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
})();
