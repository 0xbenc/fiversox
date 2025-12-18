# Firefox Extension DX Notes (WebExtensions)

## How Firefox extensions work

- `manifest.json` is the entrypoint: declares permissions (e.g. `proxy`, `storage`), UI (e.g. `action.default_popup`), and any background/content scripts.
- The popup is just a small web page (`popup.html` + JS). It runs in an isolated `moz-extension://…` origin and can call `browser.*` APIs if permissions are granted.
- Popups are ephemeral: they load when opened and are torn down when closed, so persist state via `browser.storage.local` and/or read current state via APIs like `browser.proxy.settings.get()`.

## Fast local dev loop (manual)

1. Open `about:debugging#/runtime/this-firefox` (or `about:debugging` → “This Firefox”).
2. Click “Load Temporary Add-on…” and select the extension’s `manifest.json`.
3. You must open `about:addons` → Extensions → fiversox and set “Run in Private Windows” to **Allow**; Firefox blocks proxy/SOCKS changes from extensions that aren’t allowed in private windows, so local testing won’t work until this is enabled.
4. Edit files in the repo.
5. In `about:debugging`, click “Reload” for the extension.
6. Re-open the popup from the toolbar icon to see changes.

## Debugging

- In `about:debugging`, click “Inspect” to open DevTools for the extension context (popup/background), including console output.
- For popup-specific debugging, open the popup and then inspect while it’s open to view live DOM + console.
