// Isolated-world content script: relays between the MAIN-world interceptor
// (window.postMessage) and chrome.storage, which the MAIN world cannot reach.
(() => {
  const TAG = '__flagsmith_override__';
  const { origin, hostname } = location;
  const configKey = `fso:config:${origin}`;
  const capturedKey = `fso:captured:${origin}`;
  const settingsKey = 'fso:settings';
  const enabledByDefault = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

  const sendConfig = (stored, settings) =>
    window.postMessage(
      {
        tag: TAG,
        type: 'config',
        config: {
          enabled: stored?.enabled ?? enabledByDefault,
          overrides: stored?.overrides ?? {},
          apiUrls: settings?.apiUrls ?? [],
        },
      },
      '*',
    );

  const loadAndSendConfig = () =>
    chrome.storage.local
      .get([configKey, settingsKey])
      .then((result) => sendConfig(result[configKey], result[settingsKey]));

  loadAndSendConfig();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes[configKey] || changes[settingsKey])) loadAndSendConfig();
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.tag !== TAG) return;
    if (event.data.type === 'hello') loadAndSendConfig();
    if (event.data.type === 'captured') {
      chrome.storage.local.set({ [capturedKey]: event.data.payload });
    }
  });
})();
