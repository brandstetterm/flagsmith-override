// Minimal in-memory `chrome` API so the side panel can be developed in a normal
// browser tab (see dev/preview.html). Not part of the extension.
const appConfig = {
  search: { enabled: true },
  uploads: { enabled: true },
  checkout: { enabled: true, express: true, gift_cards: true },
  notifications: {
    enabled: true,
    digest: true,
    channels: { email: { enabled: true }, push: { enabled: true }, sms: { enabled: true } },
  },
  dashboard: { enabled: true, v2: true },
  integrations: { enabled: true, slack: true, calendar: true, webhooks: true },
};

const flag = (name, enabled, value = null) => ({ name, enabled, value });

const store = {
  'fso:captured:http://localhost:3000': {
    url: 'https://flagsmith.example.com/api/v1/identities/',
    apiBase: 'https://flagsmith.example.com/api/v1/',
    identifier: 'dev@example.com',
    at: Date.now() - 60_000,
    flags: [
      flag('dark_mode', true, ''),
      flag('new_checkout', true, ''),
      flag('dashboard', true),
      flag('beta_banner', false),
      flag('legacy_reports', false),
      flag('onboarding_tour', true),
      flag('enabled_themes', true, '{\n    "Light": {\n        "enabled": true\n    }\n}'),
      flag('app_config', true, JSON.stringify(appConfig, null, 3)),
      flag('maintenance_mode', false),
      flag('experimental_search', false),
      flag('image_previews', false),
    ],
  },
};

const changeListeners = [];
const noopEvent = { addListener() {} };

window.chrome = {
  storage: {
    local: {
      async get(keys) {
        return Object.fromEntries(
          [keys].flat().filter((key) => key in store).map((key) => [key, structuredClone(store[key])]),
        );
      },
      async set(items) {
        const changes = {};
        for (const [key, newValue] of Object.entries(items)) {
          changes[key] = { oldValue: store[key], newValue };
          store[key] = structuredClone(newValue);
        }
        changeListeners.forEach((listener) => listener(changes, 'local'));
      },
    },
    onChanged: { addListener: (listener) => changeListeners.push(listener) },
  },
  tabs: {
    async query() {
      return [{ id: 1, url: 'http://localhost:3000/chat' }];
    },
    reload: () => console.info('[chrome-stub] tabs.reload'),
    onActivated: noopEvent,
    onUpdated: noopEvent,
  },
};
