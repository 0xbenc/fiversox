# fiversox

A tiny Firefox (MV3) extension that toggles Firefox’s proxy between:

- **Off**: no proxy
- **On**: manual **SOCKS v5** proxy at `localhost:<port>` (default `1080`)

Includes an optional **DNS** toggle (“Proxy DNS when using SOCKS v5”).

## What it changes

This extension **directly sets Firefox’s global proxy configuration** via `browser.proxy.settings`.

- Turning **On** overwrites whatever proxy settings you had.
- Turning **Off** sets “No proxy” (it does not restore previous settings).

## Install for development

[Developer notes](dx.md)

## Usage

- Click the extension icon to open the popup.
- Toggle **On/Off**:
  - **Off** → “No proxy”
  - **On** → SOCKS v5 `localhost:<port>`
- Change **Port** then press ✅ to apply (while On).
- Toggle **DNS** (applies immediately while On).

## Permissions / Notes

- Requires `proxy` + `storage` permissions.
- Uses `tabs` permission to briefly open/close a background tab to `https://github.com/robots.txt` to probe whether the configured proxy is reachable (shown as an icon next to the Port field).
- Firefox may require enabling **Run in Private Windows → Allow** for proxy control:
  - `about:addons` → Extensions → **fiversox** → **Run in Private Windows**

## Troubleshooting

- If you see “Proxy is controlled by another extension.” disable the other extension or uninstall it.
- If you see “Proxy settings are not controllable.” your Firefox environment/policies may block extensions from controlling proxy.

## Contributors

- 0xbenc
- basedvik
