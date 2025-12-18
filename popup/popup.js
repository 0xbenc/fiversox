/* global browser */

const DEFAULTS = Object.freeze({
  enabled: false,
  port: 1080,
  dns: false
});

const PASSTHROUGH = "localhost, 127.0.0.1, ::1";

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: #${id}`);
  return el;
};

const enabledEl = $("enabled");
const portEl = $("port");
const dnsEl = $("dns");
const statusEl = $("status");
const errorEl = $("error");

let state = { ...DEFAULTS };
let portDebounceTimer = null;
let applyInFlight = false;
let pendingApply = null;

function setStatus(msg) {
  statusEl.textContent = msg ?? "";
}

function setError(msg) {
  errorEl.textContent = msg ?? "";
}

function parsePort(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    if (value >= 1 && value <= 65535) return value;
    return null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const asNumber = Number(trimmed);
  if (!Number.isInteger(asNumber)) return null;
  if (asNumber < 1 || asNumber > 65535) return null;
  return asNumber;
}

function getSocksHost(value) {
  return String(
    value?.socks ??
      value?.socksHost ??
      value?.socks_host ??
      value?.sockshost ??
      ""
  )
    .trim()
    .toLowerCase();
}

function getSocksPort(value) {
  return parsePort(
    value?.socksPort ?? value?.socks_port ?? value?.socksport ?? null
  );
}

function getSocksVersion(value) {
  return value?.socksVersion ?? value?.socks_version ?? value?.socksversion;
}

function getProxyDNS(value) {
  return Boolean(value?.proxyDNS ?? value?.proxyDns ?? value?.proxy_dns);
}

function isLikelyOurManualProxy(value) {
  if (!value || value.proxyType !== "manual") return false;
  const host = getSocksHost(value);
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!isLocal) return false;
  const socksVersionRaw = getSocksVersion(value);
  if (
    socksVersionRaw !== undefined &&
    socksVersionRaw !== null &&
    Number(socksVersionRaw) !== 5
  ) {
    return false;
  }
  const port = getSocksPort(value);
  if (!port) return false;
  return true;
}

function proxyMatchesUiState(value, uiState) {
  if (!uiState?.enabled) return false;
  if (!value || value.proxyType !== "manual") return false;
  const port = getSocksPort(value);
  if (!port) return false;
  if (port !== uiState.port) return false;
  if (getProxyDNS(value) !== Boolean(uiState.dns)) return false;
  const socksVersionRaw = getSocksVersion(value);
  if (
    socksVersionRaw !== undefined &&
    socksVersionRaw !== null &&
    Number(socksVersionRaw) !== 5
  ) {
    return false;
  }
  const host = getSocksHost(value);
  if (host && host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
    return false;
  }
  return true;
}

function render(nextState) {
  enabledEl.checked = Boolean(nextState.enabled);
  dnsEl.checked = Boolean(nextState.dns);
  portEl.value = String(nextState.port ?? "");
}

function normalizePortField() {
  const port = parsePort(portEl.value);
  if (port) return;
  portEl.value = String(state.port);
  setError("");
}

async function loadStoredState() {
  const stored = await browser.storage.local.get(DEFAULTS);
  const port = parsePort(stored.port) ?? DEFAULTS.port;
  return {
    enabled: Boolean(stored.enabled),
    port,
    dns: Boolean(stored.dns)
  };
}

async function readProxySettings() {
  const { value, levelOfControl } = await browser.proxy.settings.get({});
  return { value, levelOfControl };
}

function formatCurrentProxy(value, uiState) {
  const t = value?.proxyType;
  if (!t) return "Unknown";
  if (t === "none" || t === "direct") return "Off (no proxy)";
  if (proxyMatchesUiState(value, uiState)) {
    return `On (SOCKS5 localhost:${uiState.port}${uiState.dns ? ", DNS" : ""})`;
  }
  if (isLikelyOurManualProxy(value)) {
    const port = getSocksPort(value) ?? DEFAULTS.port;
    const dns = getProxyDNS(value);
    return `On (SOCKS5 localhost:${port}${dns ? ", DNS" : ""})`;
  }
  if (t === "manual") {
    const port = getSocksPort(value) ?? uiState?.port ?? DEFAULTS.port;
    const dns = getProxyDNS(value) || Boolean(uiState?.dns);
    return `On (SOCKS5 localhost:${port}${dns ? ", DNS" : ""})`;
  }
  if (t === "system") return "Use system proxy settings";
  if (t === "autoDetect") return "Auto-detect proxy settings";
  if (t === "autoConfig") return "PAC URL";
  return t;
}

function computeSyncedStateFromProxy(value, fallbackState) {
  if (value?.proxyType === "none" || value?.proxyType === "direct") {
    return { ...fallbackState, enabled: false };
  }

  if (isLikelyOurManualProxy(value)) {
    return {
      enabled: true,
      port:
        getSocksPort(value) ?? fallbackState.port,
      dns: getProxyDNS(value)
    };
  }

  return null;
}

async function saveState(partial) {
  state = { ...state, ...partial };
  await browser.storage.local.set(state);
}

async function setProxyDirect() {
  await browser.proxy.settings.set({
    scope: "regular",
    value: {
      proxyType: "none"
    }
  });
}

async function setProxySocks5({ port, dns }) {
  await browser.proxy.settings.set({
    scope: "regular",
    value: {
      proxyType: "manual",
      http: "",
      httpPort: 0,
      ssl: "",
      sslPort: 0,
      ftp: "",
      ftpPort: 0,
      shareProxySettings: false,
      socks: "localhost",
      socksPort: port,
      socksVersion: 5,
      proxyDNS: Boolean(dns),
      passthrough: PASSTHROUGH
    }
  });
}

async function applyNow(nextState) {
  setError("");
  setStatus("Applying…");

  const { levelOfControl } = await readProxySettings();
  if (levelOfControl === "controlled_by_other_extensions") {
    throw new Error("Proxy is controlled by another extension.");
  }
  if (levelOfControl === "not_controllable") {
    throw new Error("Proxy settings are not controllable.");
  }

  if (!nextState.enabled) {
    await setProxyDirect();
    setStatus("Off (no proxy)");
    return;
  }

  const port = parsePort(nextState.port);
  if (!port) throw new Error("Port must be an integer from 1 to 65535.");

  await setProxySocks5({ port, dns: nextState.dns });
  setStatus(`On (SOCKS5 localhost:${port}${nextState.dns ? ", DNS" : ""})`);
}

function requestApply(nextState) {
  pendingApply = { ...nextState };
  if (applyInFlight) return;

  void (async () => {
    applyInFlight = true;
    try {
      while (pendingApply) {
        const desired = pendingApply;
        pendingApply = null;
        try {
          await applyNow(desired);
        } catch (err) {
          console.error(err);
          setStatus("");
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    } finally {
      applyInFlight = false;
    }
  })();
}

function schedulePortApply() {
  if (portDebounceTimer) clearTimeout(portDebounceTimer);
  portDebounceTimer = setTimeout(() => {
    portDebounceTimer = null;
    if (!state.enabled) return;
    requestApply(state);
  }, 180);
}

enabledEl.addEventListener("change", async () => {
  normalizePortField();
  const enabled = enabledEl.checked;
  await saveState({ enabled });
  requestApply(state);
});

dnsEl.addEventListener("change", async () => {
  normalizePortField();
  const dns = dnsEl.checked;
  await saveState({ dns });
  if (state.enabled) requestApply(state);
});

portEl.addEventListener("input", async () => {
  const port = parsePort(portEl.value);
  if (!port) {
    if (portDebounceTimer) {
      clearTimeout(portDebounceTimer);
      portDebounceTimer = null;
    }
    setStatus("");
    setError("Port must be an integer from 1 to 65535.");
    return;
  }

  setError("");
  await saveState({ port });
  schedulePortApply();
});

portEl.addEventListener("blur", () => {
  normalizePortField();
});

document.addEventListener("DOMContentLoaded", async () => {
  try {
    state = await loadStoredState();

    const { value, levelOfControl } = await readProxySettings();

    if (levelOfControl === "not_controllable") {
      setError("Proxy settings are not controllable in this context.");
    } else if (levelOfControl === "controlled_by_other_extensions") {
      setError("Proxy is controlled by another extension.");
    }

    const synced = computeSyncedStateFromProxy(value, state);
    if (synced) {
      state = synced;
      await browser.storage.local.set(state);
    }

    render(state);
    setStatus(formatCurrentProxy(value, state));
  } catch (err) {
    console.error(err);
    setError(err instanceof Error ? err.message : String(err));
  }
});
