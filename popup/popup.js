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
const portApplyEl = $("portApply");
const dnsEl = $("dns");
const statusEl = $("status");
const portStatusEl = $("portStatus");
const errorEl = $("error");

let state = { ...DEFAULTS };
let applyInFlight = false;
let pendingApply = null;
let draftPort = null;
let livePort = null;
let portHotChange = false;

const PROBE_URL = "https://github.com/robots.txt";
const PROBE_TIMEOUT_MS = 2500;
const PRIVATE_WINDOWS_HELP_URL =
  "https://github.com/0xbenc/fiversox/blob/main/docs/private-windows.md";
const PRIVATE_WINDOWS_HELP_MESSAGE =
  "Must Enable Private Windows. Turn proxy OFF before opening help -";

let probeDebounceTimer = null;
let probeSeq = 0;
let probeTabId = null;
let probeCleanup = null;
let lastProbeKey = null;
let lastOkKey = null;

function setStatus(msg) {
  statusEl.textContent = msg ?? "";
}

function isNormalProxyOutcome(value, uiState) {
  const t = value?.proxyType;
  if (!t) return false;
  if (t === "none" || t === "direct") return true;
  if (proxyMatchesUiState(value, uiState)) return true;
  if (isLikelyOurManualProxy(value)) return true;
  return false;
}

function setPortStatus(kind) {
  if (!kind) {
    portStatusEl.textContent = "";
    portStatusEl.title = "";
    portStatusEl.dataset.kind = "";
    return;
  }

  const meta =
    kind === "loading"
      ? { emoji: "⏳", title: "Checking proxy…" }
      : kind === "ok"
        ? { emoji: "✅", title: "Proxy reachable" }
        : { emoji: "❌", title: "Proxy not reachable" };

  portStatusEl.textContent = meta.emoji;
  portStatusEl.title = meta.title;
  portStatusEl.dataset.kind = kind;
}

function setError(msg) {
  if (msg && /private browsing permission/i.test(msg)) {
    setErrorWithHelp(PRIVATE_WINDOWS_HELP_MESSAGE, PRIVATE_WINDOWS_HELP_URL);
    return;
  }
  errorEl.textContent = msg ?? "";
}

function setErrorWithHelp(msg, helpUrl) {
  if (!msg) {
    setError("");
    return;
  }
  errorEl.textContent = "";
  const text = document.createTextNode(`${msg} `);
  const link = document.createElement("a");
  link.href = helpUrl;
  link.textContent = "help";
  link.target = "_blank";
  link.rel = "noreferrer";
  errorEl.append(text, link);
}

function updateLivePortFromProxy(value) {
  if (value?.proxyType === "none" || value?.proxyType === "direct") {
    livePort = null;
    return;
  }

  if (value?.proxyType === "manual") {
    livePort = getSocksPort(value);
    return;
  }

  livePort = getSocksPort(value);
}

function syncPortApplyVisibility() {
  const port = parsePort(portEl.value);
  if (!state.enabled || !port || !livePort) {
    portApplyEl.hidden = true;
    return;
  }
  portApplyEl.hidden = !portHotChange || port === livePort;
}

function cancelProbe() {
  if (probeDebounceTimer) {
    clearTimeout(probeDebounceTimer);
    probeDebounceTimer = null;
  }
  probeSeq += 1;
  if (probeCleanup) probeCleanup();
  probeCleanup = null;

  const tabId = probeTabId;
  probeTabId = null;
  if (tabId) {
    void browser.tabs.remove(tabId).catch(() => {});
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeProxyValue(value) {
  if (!value) return "null";
  return [
    `proxyType=${String(value.proxyType ?? "unknown")}`,
    `socks=${String(value.socks ?? value.socksHost ?? value.socks_host ?? "")}`,
    `socksPort=${String(
      value.socksPort ?? value.socks_port ?? value.socksport ?? ""
    )}`,
    `socksVersion=${String(
      value.socksVersion ?? value.socks_version ?? value.socksversion ?? ""
    )}`,
    `proxyDNS=${String(
      value.proxyDNS ?? value.proxyDns ?? value.proxy_dns ?? ""
    )}`
  ].join(", ");
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

function parseHostPort(raw) {
  if (typeof raw !== "string") return { host: "", port: null };
  const trimmed = raw.trim();
  if (!trimmed) return { host: "", port: null };

  const bracketed = trimmed.match(/^\[([^\]]+)\]:(\d+)$/);
  if (bracketed) {
    return { host: bracketed[1].toLowerCase(), port: parsePort(bracketed[2]) };
  }

  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon === -1) return { host: trimmed.toLowerCase(), port: null };

  const hostPart = trimmed.slice(0, lastColon);
  const portPart = trimmed.slice(lastColon + 1);
  const port = parsePort(portPart);
  if (!port) return { host: trimmed.toLowerCase(), port: null };
  return { host: hostPart.toLowerCase(), port };
}

function getSocksHost(value) {
  const raw = String(
    value?.socks ??
      value?.socksHost ??
      value?.socks_host ??
      value?.sockshost ??
      ""
  )
    .trim();
  return parseHostPort(raw).host;
}

function getSocksPort(value) {
  const explicit = parsePort(
    value?.socksPort ?? value?.socks_port ?? value?.socksport ?? null
  );
  if (explicit) return explicit;
  const raw = String(
    value?.socks ??
      value?.socksHost ??
      value?.socks_host ??
      value?.sockshost ??
      ""
  ).trim();
  return parseHostPort(raw).port;
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
  draftPort = nextState.port ?? null;
  portApplyEl.hidden = true;
  portHotChange = false;
}

function normalizePortField() {
  const port = parsePort(portEl.value);
  if (port) return;
  portEl.value = String(state.port);
  draftPort = state.port;
  portApplyEl.hidden = true;
  setError("");
  syncPortApplyVisibility();
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

async function setProxySettings(value) {
  await browser.proxy.settings.set({ scope: "regular", value });
  try {
    await browser.proxy.settings.set({ scope: "private", value });
  } catch (err) {
    // ignore if unsupported
  }
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
  await setProxySettings({ proxyType: "none" });
}

async function setProxySocks5({ port, dns }) {
  await setProxySettings({
    proxyType: "manual",
    socks: `localhost:${port}`,
    socksHost: "localhost",
    socksPort: port,
    socksVersion: 5,
    proxyDNS: Boolean(dns),
    passthrough: PASSTHROUGH
  });
}

async function applyNow(nextState) {
  setError("");
  setStatus("Applying…");
  setPortStatus("loading");

  const { value: beforeValue, levelOfControl } = await readProxySettings();
  if (levelOfControl === "controlled_by_other_extensions") {
    throw new Error("Proxy is controlled by another extension.");
  }
  if (levelOfControl === "not_controllable") {
    throw new Error("Proxy settings are not controllable.");
  }

  if (!nextState.enabled) {
    await setProxyDirect();
    updateLivePortFromProxy({ proxyType: "none" });
    setStatus("");
    setPortStatus(null);
    portHotChange = false;
    syncPortApplyVisibility();
    cancelProbe();
    return;
  }

  const port = parsePort(nextState.port);
  if (!port) throw new Error("Port must be an integer from 1 to 65535.");

  const beforePort = getSocksPort(beforeValue);
  if (beforeValue?.proxyType === "manual" && beforePort && beforePort !== port) {
    await setProxyDirect();
    await sleep(60);
  }

  await setProxySocks5({ port, dns: nextState.dns });

  const expectedDns = Boolean(nextState.dns);
  const retryDelaysMs = [0, 40, 120, 260, 520];
  let value = null;
  let appliedPort = null;
  let appliedDns = false;

  for (const delayMs of retryDelaysMs) {
    if (delayMs) await sleep(delayMs);
    ({ value } = await readProxySettings());
    appliedPort = getSocksPort(value);
    appliedDns = getProxyDNS(value);
    if (
      value?.proxyType === "manual" &&
      appliedPort === port &&
      Boolean(appliedDns) === expectedDns
    ) {
      break;
    }
  }

  if (value?.proxyType !== "manual" || !appliedPort) {
    throw new Error(
      `Proxy settings did not apply (${describeProxyValue(value)}).`
    );
  }

  if (appliedPort !== port || Boolean(appliedDns) !== expectedDns) {
    throw new Error(
      `Proxy settings did not apply (expected ${port}${expectedDns ? " +DNS" : ""}, got ${appliedPort}${appliedDns ? " +DNS" : ""}).`
    );
  }

  updateLivePortFromProxy(value);
  setStatus("");
  portHotChange = false;
  syncPortApplyVisibility();
  scheduleProbe({ ...nextState, port: appliedPort, dns: appliedDns }, 0);
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
          setPortStatus(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    } finally {
      applyInFlight = false;
    }
  })();
}

function scheduleProbe(nextState, delayMs = 250) {
  if (probeDebounceTimer) clearTimeout(probeDebounceTimer);
  probeDebounceTimer = setTimeout(() => {
    probeDebounceTimer = null;
    startProbe(nextState);
  }, delayMs);
}

function startProbe(nextState) {
  if (!nextState?.enabled) {
    cancelProbe();
    setPortStatus(null);
    lastProbeKey = null;
    lastOkKey = null;
    return;
  }

  const port = parsePort(nextState.port);
  if (!port) {
    setPortStatus(null);
    return;
  }

  const key = `${port}|${Boolean(nextState.dns)}`;
  if (key !== lastProbeKey) {
    lastProbeKey = key;
    lastOkKey = null;
  }

  probeSeq += 1;
  const seq = probeSeq;

  if (probeCleanup) probeCleanup();
  probeCleanup = null;

  void (async () => {
    setPortStatus("loading");
    try {
      const created = await browser.tabs.create({ url: PROBE_URL, active: false });
      if (seq !== probeSeq) return;
      probeTabId = created.id ?? null;
      if (!probeTabId) {
        if (lastOkKey !== key) setPortStatus("fail");
        return;
      }

      let done = false;
      let timeoutId = null;

      const finish = async (ok) => {
        if (done) return;
        done = true;
        if (seq !== probeSeq) return;

        if (probeCleanup) probeCleanup();
        probeCleanup = null;

        if (ok) {
          lastOkKey = key;
          setPortStatus("ok");
        } else if (lastOkKey !== key) {
          setPortStatus("fail");
        }

        const tabId = probeTabId;
        probeTabId = null;
        try {
          if (tabId) await browser.tabs.remove(tabId);
        } catch (err) {
          // ignore
        }
      };

      const onUpdated = (tabId, changeInfo, tab) => {
        if (seq !== probeSeq) return;
        if (tabId !== probeTabId) return;
        if (changeInfo.status !== "complete") return;
        const url = String(tab?.url ?? "");
        const ok = url.startsWith(PROBE_URL);
        void finish(ok);
      };

      browser.tabs.onUpdated.addListener(onUpdated);

      timeoutId = setTimeout(() => {
        if (seq !== probeSeq) return;
        void finish(false);
      }, PROBE_TIMEOUT_MS);

      probeCleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        try {
          browser.tabs.onUpdated.removeListener(onUpdated);
        } catch (err) {
          // ignore
        }
        probeCleanup = null;
      };
    } catch (err) {
      if (seq !== probeSeq) return;
      if (lastOkKey !== key) setPortStatus("fail");
    }
  })();
}

enabledEl.addEventListener("change", async () => {
  normalizePortField();
  const draft = parsePort(portEl.value);
  if (draft && draft !== state.port) {
    portApplyEl.hidden = true;
    await saveState({ port: draft });
  }
  portHotChange = false;
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

portEl.addEventListener("input", async (e) => {
  const userInitiated = Boolean(e?.isTrusted) && document.activeElement === portEl;
  if (!userInitiated) {
    portHotChange = false;
    portApplyEl.hidden = true;
    return;
  }

  const port = parsePort(portEl.value);
  if (!port) {
    setStatus("");
    setPortStatus(null);
    setError("Port must be an integer from 1 to 65535.");
    portApplyEl.hidden = true;
    portHotChange = false;
    return;
  }

  setError("");
  draftPort = port;

  if (!state.enabled) {
    portApplyEl.hidden = true;
    setPortStatus(null);
    if (port !== state.port) await saveState({ port });
    return;
  }

  syncPortApplyVisibility();
  if (livePort && port !== livePort) setPortStatus(null);
});

portEl.addEventListener("beforeinput", (e) => {
  if (!state.enabled) return;
  if (!e.isTrusted) return;
  portHotChange = true;
  syncPortApplyVisibility();
});

portEl.addEventListener("blur", () => {
  normalizePortField();
});

portEl.addEventListener("keydown", (e) => {
  if (state.enabled && e.isTrusted) {
    const key = String(e.key ?? "");
    const isEditKey =
      key.length === 1 ||
      key === "Backspace" ||
      key === "Delete" ||
      key === "ArrowUp" ||
      key === "ArrowDown";
    if (isEditKey) portHotChange = true;
  }

  if (e.key !== "Enter") return;
  if (portApplyEl.hidden) return;
  e.preventDefault();
  portApplyEl.click();
});

portApplyEl.addEventListener("click", async () => {
  const port = parsePort(portEl.value);
  if (!port) {
    setPortStatus(null);
    setError("Port must be an integer from 1 to 65535.");
    return;
  }

  setError("");
  portApplyEl.hidden = true;
  portHotChange = false;
  await saveState({ port });
  if (state.enabled) requestApply(state);
});

document.addEventListener("DOMContentLoaded", async () => {
  try {
    state = await loadStoredState();

    const { value, levelOfControl } = await readProxySettings();
    updateLivePortFromProxy(value);

    if (levelOfControl === "not_controllable") {
      setError("Proxy settings are not controllable in this context.");
    } else if (levelOfControl === "controlled_by_other_extensions") {
      setError("Proxy is controlled by another extension.");
    }

    const incognitoAllowed = await browser.extension.isAllowedIncognitoAccess();
    if (!incognitoAllowed) {
      setErrorWithHelp(
        PRIVATE_WINDOWS_HELP_MESSAGE,
        PRIVATE_WINDOWS_HELP_URL
      );
    }

    const synced = computeSyncedStateFromProxy(value, state);
    if (synced) {
      state = synced;
      await browser.storage.local.set(state);
    }

    render(state);
    if (isNormalProxyOutcome(value, state)) {
      setStatus("");
    } else {
      setStatus(formatCurrentProxy(value, state));
    }
    syncPortApplyVisibility();
    scheduleProbe(state, 0);
  } catch (err) {
    console.error(err);
    setError(err instanceof Error ? err.message : String(err));
  }
});
