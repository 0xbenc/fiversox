# Repository Guidelines

## Project Structure & Module Organization

- `manifest.json`: MV3 WebExtension entrypoint (permissions + popup wiring).
- `popup/`: UI and logic (`popup.html`, `popup.css`, `popup.js`).
- `icons/`: extension icon assets (SVG used for all sizes).
- Docs: `README.md` (usage), `docs/dx.md` (dev notes)

## Build, Test, and Development Commands

This repository is a static Firefox extension (no bundler/build step).

- **Run locally (manual):**
  1. Open `about:debugging#/runtime/this-firefox`
  2. **Load Temporary Add-on…** → select `manifest.json`
  3. After edits, click **Reload** for the add-on and re-open the popup.
- **Optional tooling (if installed):** `web-ext run -s .` (launches a dev profile and can auto-reload on changes).
- **Quick syntax check:** `node --check popup/popup.js`

## Coding Style & Naming Conventions

- Indentation: 2 spaces (JS/CSS/JSON); keep `manifest.json` pretty-printed.
- JavaScript: prefer `const`/`let`, semicolons, and double quotes (match `popup/popup.js`).
- Keep file naming consistent with existing patterns (e.g., `popup/popup.*`).
- Avoid expanding permissions/APIs unless the change clearly requires it.

## Testing Guidelines

No automated test suite is currently included; rely on manual verification:

- Toggle **On/Off** updates `browser.proxy.settings` and matches the popup status line.
- Port validation rejects non-integers and values outside `1–65535`.
- DNS toggle behavior applies only while enabled.
- Error states render clearly when proxy control is blocked (e.g., “controlled by another extension”).

## Commit & Pull Request Guidelines

- Git history uses short, subject-only commit messages (e.g., `README`, `initial work`); keep subjects concise and action-oriented.
- PRs should include: summary of behavior changes, step-by-step test notes, and screenshots for popup UI changes.
- For user-facing changes, bump `manifest.json` `version` and update `README.md` when needed.
- Don't commit unless explicitly told to. And then only assume you had permission that once
- Don't push unless explicitly told to. And then only assume you had permission that once

## Security & Configuration Tips

This extension overwrites Firefox’s global proxy settings. Call out any behavior changes in PRs, keep permissions minimal, and avoid logging or persisting sensitive proxy data.
