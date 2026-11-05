import {
  capturedKey,
  configKey,
  enabledByDefault,
  loadCaptured,
  loadConfig,
  loadSettings,
  normalizeApiUrl,
  originOf,
  saveConfig,
  saveSettings,
  settingsKey,
} from '../lib/store.js';

const state = {
  tabId: null,
  origin: null,
  config: null,
  captured: null,
  settings: { apiUrls: [] },
  settingsOpen: false,
  search: '',
  onlyOverridden: false,
  expanded: new Set(),
  rawMode: new Set(),
  collapsedNodes: new Set(),
  rawErrors: new Map(),
  // Flags auto-expanded by a JSON key match that the user collapsed again during this search.
  searchCollapsed: new Set(),
};

const $ = (selector) => document.querySelector(selector);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'className') node.className = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter((child) => child !== null && child !== undefined));
  return node;
}

// ---- Values -----------------------------------------------------------------

const parseJson = (value) => {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const sameValue = (a, b) => {
  if (a === b) return true;
  const parsedA = parseJson(a);
  const parsedB = parseJson(b);
  return parsedA !== undefined && parsedB !== undefined && sameJson(parsedA, parsedB);
};

const searchQuery = () => state.search.trim().toLowerCase();

// True if any key at any depth of a parsed JSON value contains the query.
const hasMatchingKey = (value, query) =>
  value !== null &&
  typeof value === 'object' &&
  Object.entries(value).some(
    ([key, child]) => key.toLowerCase().includes(query) || hasMatchingKey(child, query),
  );

// Wraps the matching part of a key in <mark>.
function highlight(text, query) {
  const index = query ? text.toLowerCase().indexOf(query) : -1;
  if (index < 0) return text;
  return [text.slice(0, index), el('mark', {}, text.slice(index, index + query.length)), text.slice(index + query.length)];
}

const describe = (value) => (value === undefined ? 'not present' : JSON.stringify(value));

// ---- Data -------------------------------------------------------------------

const capturedFlag = (name) => state.captured?.flags.find((flag) => flag.name === name) ?? null;

function flagRows() {
  const captured = state.captured?.flags ?? [];
  const overrides = state.config.overrides;
  const known = new Set(captured.map((flag) => flag.name));
  const rows = [...captured.map((flag) => flag.name), ...Object.keys(overrides).filter((n) => !known.has(n))]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const original = capturedFlag(name);
      const override = overrides[name];
      return {
        name,
        original,
        override,
        enabled: override && 'enabled' in override ? override.enabled : original?.enabled ?? false,
        value: override && 'value' in override ? override.value : original?.value ?? null,
      };
    });
  const query = searchQuery();
  return rows
    .map((row) => {
      const nameMatch = !query || row.name.toLowerCase().includes(query);
      // A flag found only through a nested JSON key opens with its tree filtered to that key.
      const jsonMatch = !nameMatch && hasMatchingKey(parseJson(row.value), query);
      return { ...row, nameMatch, jsonMatch };
    })
    .filter((row) => (row.nameMatch || row.jsonMatch) && (!state.onlyOverridden || row.override));
}

async function persist(partial) {
  state.config = { ...state.config, ...partial, updatedAt: Date.now() };
  render();
  await saveConfig(state.origin, { enabled: state.config.enabled, overrides: state.config.overrides });
}

function updateOverride(name, patch) {
  const original = capturedFlag(name);
  const next = { ...state.config.overrides[name], ...patch };
  if (original) {
    if ('enabled' in next && next.enabled === original.enabled) delete next.enabled;
    if ('value' in next && sameValue(next.value, original.value)) delete next.value;
  }
  const overrides = { ...state.config.overrides };
  if (Object.keys(next).length > 0 || !original) overrides[name] = next;
  else delete overrides[name];
  return persist({ overrides });
}

function resetOverride(name, field) {
  const overrides = { ...state.config.overrides };
  if (field && capturedFlag(name)) {
    const { [field]: _removed, ...rest } = overrides[name] ?? {};
    if (Object.keys(rest).length) overrides[name] = rest;
    else delete overrides[name];
  } else {
    delete overrides[name];
  }
  state.rawErrors.delete(name);
  return persist({ overrides });
}

// ---- Rendering: JSON tree ---------------------------------------------------

// With "Changed only" active, unchanged leaves and fully unchanged branches are skipped,
// so only the changed keys and their ancestors remain. With a `query`, only keys containing
// it (with their whole subtree) and their ancestors remain.
function treeNode(container, key, originalContainer, path, commit, query) {
  const value = container[key];
  const original =
    originalContainer !== null && typeof originalContainer === 'object' ? originalContainer[key] : undefined;
  const changed = !sameJson(value, original);
  if (state.onlyOverridden && !changed) return null;
  const keyText = Array.isArray(container) ? `[${key}]` : String(key);
  const keyMatch = Boolean(query) && String(key).toLowerCase().includes(query);
  if (query && !keyMatch && !hasMatchingKey(value, query)) return null;
  const childQuery = keyMatch ? null : query;
  const keyLabel = el('span', { className: 'key' }, query ? highlight(keyText, query) : keyText);

  if (value !== null && typeof value === 'object') {
    const size = Object.keys(value).length;
    return el(
      'details',
      {
        open: !state.collapsedNodes.has(path),
        onToggle: (event) => {
          if (event.target.open) state.collapsedNodes.delete(path);
          else state.collapsedNodes.add(path);
        },
      },
      el(
        'summary',
        { className: changed ? 'has-changes' : '' },
        keyLabel,
        el('span', { className: 'count' }, Array.isArray(value) ? `[${size}]` : `{${size}}`),
      ),
      Object.keys(value).map((childKey) =>
        treeNode(
          value,
          Array.isArray(value) ? Number(childKey) : childKey,
          original,
          `${path}/${childKey}`,
          commit,
          childQuery,
        ),
      ),
    );
  }

  const set = (next) => {
    container[key] = next;
    commit();
  };
  let editor;
  if (typeof value === 'boolean') {
    editor = el(
      'label',
      { className: `switch small${changed ? ' overridden' : ''}` },
      el('input', { type: 'checkbox', checked: value, onChange: (event) => set(event.target.checked) }),
      el('span', { className: 'track' }),
    );
  } else if (typeof value === 'number') {
    editor = el('input', {
      className: 'input',
      type: 'number',
      value: String(value),
      onChange: (event) => set(Number(event.target.value)),
    });
  } else if (typeof value === 'string') {
    editor = el('input', { className: 'input', value, onChange: (event) => set(event.target.value) });
  } else {
    editor = el('span', { className: 'null' }, 'null');
  }

  return el(
    'div',
    { className: `leaf${changed ? ' changed' : ''}`, title: changed ? `Original: ${describe(original)}` : '' },
    keyLabel,
    editor,
  );
}

function renderTree(row, parsed) {
  const draft = structuredClone(parsed);
  const originalParsed = parseJson(row.original?.value);
  const commit = () => updateOverride(row.name, { value: JSON.stringify(draft, null, 2) });
  const query = row.jsonMatch ? searchQuery() : null;
  const nodes = Object.keys(draft)
    .map((key) =>
      treeNode(draft, Array.isArray(draft) ? Number(key) : key, originalParsed, `${row.name}:${key}`, commit, query),
    )
    .filter(Boolean);
  if (nodes.length === 0) {
    return el(
      'p',
      { className: 'tree-note' },
      query ? 'No changed key matches the search.' : 'Value unchanged. Turn off “Changed only” to edit it.',
    );
  }
  return el('div', { className: 'tree' }, nodes);
}

// ---- Rendering: raw editors -------------------------------------------------

function renderRawJson(row) {
  // An invalid draft is kept (with its parse error) instead of being replaced by the saved value.
  const error = state.rawErrors.get(row.name);
  const text = error?.text ?? row.value ?? '';
  const textarea = el('textarea', {
    className: `textarea${error ? ' invalid' : ''}`,
    rows: Math.min(18, Math.max(4, text.split('\n').length)),
    value: text,
    spellcheck: false,
    onChange: (event) => {
      const text = event.target.value;
      try {
        JSON.parse(text);
      } catch (parseError) {
        state.rawErrors.set(row.name, { text, message: parseError.message });
        render();
        return;
      }
      state.rawErrors.delete(row.name);
      updateOverride(row.name, { value: text });
    },
    onKeydown: (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) event.target.blur();
    },
  });
  return [textarea, error ? el('p', { className: 'error' }, error.message) : null];
}

function renderText(row) {
  return el('textarea', {
    className: 'textarea',
    rows: 2,
    value: row.value ?? '',
    placeholder: row.value === null ? 'null' : '',
    spellcheck: false,
    onChange: (event) => {
      const text = event.target.value;
      const originalValue = row.original?.value;
      const emptyOriginal = originalValue === null || originalValue === '' || originalValue === undefined;
      updateOverride(row.name, { value: text === '' && emptyOriginal ? originalValue ?? null : text });
    },
  });
}

function renderBody(row) {
  const parsed = parseJson(row.value);
  const isJson = parsed !== undefined;
  const raw = state.rawMode.has(row.name) || state.rawErrors.has(row.name);
  const valueOverridden = Boolean(row.override && 'value' in row.override);

  const toggleRaw = () => {
    if (state.rawMode.has(row.name)) state.rawMode.delete(row.name);
    else state.rawMode.add(row.name);
    state.rawErrors.delete(row.name);
    render();
  };

  const toolbar = el(
    'div',
    { className: 'body-toolbar' },
    el('span', {}, isJson ? 'JSON value' : 'Value (feature_state_value)'),
    el(
      'div',
      { className: 'actions' },
      isJson || raw
        ? el('button', { className: 'button small', type: 'button', onClick: toggleRaw }, raw ? 'Tree' : 'Raw JSON')
        : null,
      valueOverridden
        ? el(
            'button',
            { className: 'button small', type: 'button', onClick: () => resetOverride(row.name, 'value') },
            'Reset value',
          )
        : null,
    ),
  );

  let editor;
  if (isJson && !raw) editor = renderTree(row, parsed);
  else if (isJson || raw) editor = renderRawJson(row);
  else editor = renderText(row);

  return el('div', { className: 'flag-body' }, toolbar, editor);
}

// ---- Rendering: list --------------------------------------------------------

function renderRow(row) {
  const expanded =
    state.expanded.has(row.name) || (row.jsonMatch && !state.searchCollapsed.has(row.name));
  const enabledOverridden = Boolean(row.override && 'enabled' in row.override);
  const isNew = !row.original;
  const toggleExpanded = () => {
    if (expanded) {
      state.expanded.delete(row.name);
      state.searchCollapsed.add(row.name);
    } else {
      state.expanded.add(row.name);
      state.searchCollapsed.delete(row.name);
    }
    render();
  };

  return el(
    'li',
    { className: `flag${row.override ? ' overridden' : ''}${expanded ? ' expanded' : ''}` },
    el(
      'div',
      { className: 'flag-head' },
      el(
        'label',
        {
          className: `switch${enabledOverridden ? ' overridden' : ''}`,
          title: enabledOverridden ? `Original: ${row.original?.enabled ? 'on' : 'off'}` : 'enabled',
        },
        el('input', {
          type: 'checkbox',
          checked: row.enabled,
          onChange: (event) => updateOverride(row.name, { enabled: event.target.checked }),
        }),
        el('span', { className: 'track' }),
      ),
      el(
        'button',
        { className: 'flag-name', type: 'button', onClick: toggleExpanded, 'aria-expanded': String(expanded) },
        el('span', { className: 'chevron' }, '▶'),
        el('span', { className: 'label' }, highlight(row.name, row.nameMatch ? searchQuery() : '')),
        parseJson(row.value) ? el('span', { className: 'badge' }, 'JSON') : null,
        isNew ? el('span', { className: 'badge new' }, 'new') : null,
        row.override && !isNew ? el('span', { className: 'badge override' }, 'changed') : null,
      ),
      el(
        'button',
        {
          className: 'icon-button',
          type: 'button',
          title: isNew ? 'Remove flag' : 'Reset to Flagsmith value',
          hidden: !row.override,
          onClick: () => resetOverride(row.name),
        },
        isNew ? '✕' : '↺',
      ),
    ),
    expanded ? renderBody(row) : null,
  );
}

function renderHeader() {
  const { config, captured, origin } = state;
  $('#origin').textContent = origin ? origin.replace(/^https?:\/\//, '') : 'No web page';
  $('#enabled').checked = Boolean(config?.enabled);
  $('#enabled').disabled = !origin;

  const count = config ? Object.keys(config.overrides).length : 0;
  $('#status').textContent = captured
    ? [
        `${captured.flags.length} flags`,
        `${count} changed`,
        `captured ${new Date(captured.at).toLocaleTimeString()}`,
        captured.identifier,
      ]
        .filter(Boolean)
        .join(' · ')
    : count
      ? `${count} changed · no Flagsmith request captured yet`
      : '';

  const banner = $('#banner');
  const messages = [];
  const needsReload = Boolean(captured && config && config.updatedAt > captured.at);
  if (config?.enabled && origin && !enabledByDefault(origin)) {
    messages.push('Not a local environment. Overrides apply here too.');
  }
  if (needsReload) messages.push('Reload to apply changes.');
  banner.hidden = messages.length === 0;
  banner.replaceChildren(
    el('span', {}, messages.join(' ')),
    needsReload ? el('button', { className: 'button small', type: 'button', onClick: reloadTab }, 'Reload') : null,
  );
}

function renderSettings() {
  const toggle = $('#settings-toggle');
  toggle.classList.toggle('active', state.settingsOpen);
  toggle.setAttribute('aria-expanded', String(state.settingsOpen));
  $('#settings').hidden = !state.settingsOpen;

  const detected = $('#detected');
  const apiBase = state.captured?.apiBase;
  const alreadyListed = apiBase && $('#api-urls').value.split('\n').some((line) => line.trim() === apiBase);
  detected.hidden = !apiBase;
  detected.replaceChildren(
    ...(apiBase
      ? [
          el('p', {}, 'Detected on this tab: ', el('code', { title: apiBase }, apiBase)),
          alreadyListed
            ? null
            : el(
                'button',
                {
                  className: 'button small',
                  type: 'button',
                  onClick: () => {
                    const textarea = $('#api-urls');
                    textarea.value = [textarea.value.trim(), apiBase].filter(Boolean).join('\n');
                    renderSettings();
                  },
                },
                'Use',
              ),
        ].filter(Boolean)
      : []),
  );
}

function render() {
  renderHeader();
  renderSettings();
  const list = $('#flags');
  const empty = $('#empty');
  const scrollTop = list.parentElement.scrollTop;

  if (!state.origin || !state.config) {
    list.replaceChildren();
    empty.hidden = false;
    empty.textContent = 'Nothing to override on this page.';
    return;
  }

  const rows = flagRows();
  list.replaceChildren(...rows.map(renderRow));
  empty.hidden = rows.length > 0;
  empty.textContent = state.captured
    ? 'No flag matches the filter.'
    : state.settings.apiUrls.length
      ? 'No Flagsmith request captured yet. Reload the tab, or check the API URLs in the settings (⚙).'
      : 'No Flagsmith request captured yet. Reload the tab once the app loads its flags.';
  list.parentElement.scrollTop = scrollTop;
}

// ---- Tab + storage sync -----------------------------------------------------

async function loadOrigin() {
  if (!state.origin) {
    state.config = null;
    state.captured = null;
  } else {
    [state.config, state.captured] = await Promise.all([loadConfig(state.origin), loadCaptured(state.origin)]);
  }
  render();
}

async function syncActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tabId = tab?.id ?? null;
  const origin = originOf(tab?.url ?? '');
  if (origin !== state.origin) {
    state.origin = origin;
    state.expanded.clear();
    state.rawMode.clear();
    state.rawErrors.clear();
    state.collapsedNodes.clear();
  }
  await loadOrigin();
}

function reloadTab() {
  if (state.tabId !== null) chrome.tabs.reload(state.tabId);
}

chrome.tabs.onActivated.addListener(syncActiveTab);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === state.tabId && changeInfo.url) syncActiveTab();
});
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes[settingsKey]) {
    state.settings = await loadSettings();
    render();
  }
  if (state.origin && (changes[capturedKey(state.origin)] || changes[configKey(state.origin)])) loadOrigin();
});

// ---- Controls ---------------------------------------------------------------

$('#enabled').addEventListener('change', (event) => persist({ enabled: event.target.checked }));

$('#search').addEventListener('input', (event) => {
  state.search = event.target.value;
  state.searchCollapsed.clear();
  render();
});

$('#only-overridden').addEventListener('change', (event) => {
  state.onlyOverridden = event.target.checked;
  render();
});

function openSettings(open) {
  state.settingsOpen = open;
  $('#api-urls').value = state.settings.apiUrls.join('\n');
  $('#settings-error').hidden = true;
  render();
}

$('#settings-toggle').addEventListener('click', () => openSettings(!state.settingsOpen));
$('#settings-cancel').addEventListener('click', () => openSettings(false));
$('#api-urls').addEventListener('input', renderSettings);

$('#settings-save').addEventListener('click', async () => {
  const lines = $('#api-urls')
    .value.split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const apiUrls = [];
  for (const line of lines) {
    try {
      apiUrls.push(normalizeApiUrl(line));
    } catch {
      $('#settings-error').textContent = `Not a valid http(s) URL: ${line}`;
      $('#settings-error').hidden = false;
      return;
    }
  }
  state.settings = { apiUrls: [...new Set(apiUrls)] };
  await saveSettings(state.settings);
  openSettings(false);
});

$('#add-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('#add-name');
  const name = input.value.trim();
  if (!name || !state.config) return;
  input.value = '';
  state.expanded.add(name);
  if (!capturedFlag(name) && !state.config.overrides[name]) updateOverride(name, { enabled: true, value: null });
  else render();
});

$('#reload').addEventListener('click', reloadTab);

$('#export').addEventListener('click', () => {
  if (!state.config) return;
  const blob = new Blob(
    [JSON.stringify({ origin: state.origin, overrides: state.config.overrides }, null, 2)],
    { type: 'application/json' },
  );
  const link = el('a', {
    href: URL.createObjectURL(blob),
    download: `flagsmith-overrides-${new URL(state.origin).host.replace(/[^\w.-]/g, '_')}.json`,
  });
  link.click();
  URL.revokeObjectURL(link.href);
});

$('#import').addEventListener('click', () => $('#import-file').click());

$('#import-file').addEventListener('change', async (event) => {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file || !state.config) return;
  try {
    const { overrides } = JSON.parse(await file.text());
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error();
    await persist({ overrides });
  } catch {
    $('#status').textContent = 'Import failed: expected { "overrides": { … } }.';
  }
});

let resetArmed = null;
$('#reset-all').addEventListener('click', (event) => {
  const button = event.currentTarget;
  if (!resetArmed) {
    button.textContent = 'Really reset all?';
    resetArmed = setTimeout(() => {
      button.textContent = 'Reset all';
      resetArmed = null;
    }, 3000);
    return;
  }
  clearTimeout(resetArmed);
  resetArmed = null;
  button.textContent = 'Reset all';
  state.rawErrors.clear();
  persist({ overrides: {} });
});

state.settings = await loadSettings();
syncActiveTab();
