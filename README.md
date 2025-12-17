# fiversox

A tiny Firefox (MV3) extension that toggles Firefox’s proxy between:

- **Off**: no proxy
- **On**: manual **SOCKS v5** proxy at `localhost:<port>` (default `1080`)

Includes an optional **DNS** toggle (“Proxy DNS when using SOCKS v5”).

## What it changes

This extension **directly sets Firefox’s global proxy configuration** via `browser.proxy.settings`.

- Turning **On** overwrites whatever proxy settings you had.
- Turning **Off** sets “No proxy” (it does not restore previous settings).

## Install / Dev

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `manifest.json`

After edits:

- In `about:debugging`, click **Reload** for the add-on.

## Usage

- Click the extension icon to open the popup.
- Toggle **On/Off**:
  - **Off** → “No proxy”
  - **On** → SOCKS v5 `localhost:<port>`
- Change **Port** (applies immediately while On).
- Toggle **DNS** (applies immediately while On).

## Permissions / Notes

- Requires `proxy` + `storage` permissions.
- Firefox may require enabling **Run in Private Windows → Allow** for proxy control:
  - `about:addons` → Extensions → **fiversox** → **Run in Private Windows**

## Troubleshooting

- If you see “Proxy is controlled by another extension.” disable the other extension or uninstall it.
- If you see “Proxy settings are not controllable.” your Firefox environment/policies may block extensions from controlling proxy.
