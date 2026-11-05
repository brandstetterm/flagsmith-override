<img src="icons/icon-128.png" width="64" height="64" alt="" align="right">

# Flagsmith Override

Chrome extension (Manifest V3) for overriding Flagsmith flags locally in the browser. Flagsmith itself
is never changed. The extension intercepts the flag response in the page
(`POST …/identities/` or `GET …/flags/`), shows the original flags in a side panel and hands the app
a response with your overrides applied.

- Toggle a flag's `enabled`.
- Edit `feature_state_value`. JSON values such as an `app_config` flag are shown as a tree with
  switches for nested booleans. Changed keys are highlighted and the original value is in the
  tooltip. A raw JSON editor is available as well.
- **Changed only** filters both the flag list and the JSON trees down to what you changed.
- Add flags that Flagsmith doesn't return (yet).
- Overrides are stored per origin (`localhost:3000`, dev, beta …) and can be exported and imported as JSON.
- The toolbar badge shows how many overrides are active on the current tab.

By default the extension is only active on `localhost`, `127.0.0.1` and `[::1]`. Other origins need
the **Active** switch in the panel, and then show a warning.

## Install

The extension isn't in the Chrome Web Store. You load it as an unpacked extension:

1. Download `flagsmith-override-v….zip` from the
   [latest release](https://github.com/brandstetterm/flagsmith-override/releases/latest).
2. Unzip it to a folder you keep, e.g. `~/Extensions/flagsmith-override`. Chrome loads the extension
   from that folder, so don't delete it afterwards.
3. Open `chrome://extensions` and turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped `flagsmith-override` folder.
5. Pin the extension (puzzle icon → pin) and click its icon to open the side panel.

Works in Chrome 116+ and other Chromium browsers with side panel support (e.g. Edge).

**Update:** download the new ZIP, replace the contents of the folder, then click ↻ on the extension in
`chrome://extensions`. Your overrides and settings are kept.

**From source:** clone this repository and load the repository folder itself with **Load unpacked**.
No build step is needed.

## Usage

1. Open the app. Its flags appear in the panel as soon as it loads them.
2. Toggle flags or edit values.
3. Reload the tab (button in the panel, or ⌘R). Overrides apply to the next Flagsmith request.

## Detecting the Flagsmith request

By default the extension auto-detects any successful response from `…/api/v1/identities/` or
`…/api/v1/flags/` whose body looks like a Flagsmith flag list (`feature.name` on every entry).

To restrict it to specific instances, open **⚙ Settings** and enter one or more API base URLs, the
same value the app passes to `flagsmith.init({ api })`, e.g. `https://flagsmith.example.com/api/v1/`.
**Use** fills in the URL detected on the current tab. Then only `<base>identities/` and `<base>flags/`
are intercepted. The setting is global, not per origin, and is stored in `chrome.storage.local`.

## How it works

| File | Role |
|------|------|
| `content/main.js` | Runs in the page's MAIN world at `document_start` and wraps `window.fetch` before the app bundle captures it. Matches Flagsmith responses, reports the originals and returns a patched `Response`. |
| `content/bridge.js` | Isolated world: relays between `window.postMessage` and `chrome.storage`. |
| `panel/` | Side panel UI (vanilla JS, no dependencies). |
| `background.js` | Opens the panel on toolbar click and maintains the badge. |
| `scripts/` | `package.sh` builds the release ZIP into `dist/`, `release.sh` tags and publishes a GitHub release. |
| `dev/` | `preview.html` with a `chrome` stub for working on the panel in a normal tab: run `python3 -m http.server 4480` here and open `/dev/preview.html`. `render-icons.swift` regenerates the PNG icons from `icons/icon.svg` (macOS). |

## Releasing

1. Bump `version` in `manifest.json` and commit.
2. Run `scripts/release.sh`. It builds `dist/flagsmith-override-v<version>.zip`, tags `v<version>`
   and creates the GitHub release with the ZIP attached (needs the `gh` CLI).

## Limitations

- Overrides only affect the frontend. If the backend checks the same flags itself, the feature stays
  blocked there.
- Only `fetch` is intercepted, not `XMLHttpRequest`. The Flagsmith JS SDK uses `fetch`.
- Changes apply on reload. There is no live update.
- Chrome/Edge only. Firefox would need `sidebar_action` instead of `side_panel`.

## License

[MIT](LICENSE)
