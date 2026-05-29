// popup.js — keeps the popup UI in sync with chrome.storage and the background worker.

const enabledEl     = document.getElementById("enabled");
const intervalEl    = document.getElementById("interval");
const newChatUrlEl  = document.getElementById("newChatUrl");
const chatMessageEl = document.getElementById("chatMessage");
const urlHintEl     = document.getElementById("urlHint");
const savedLabelEl  = document.getElementById("savedLabel");
const statusEl      = document.getElementById("status");
const runBtn        = document.getElementById("runNow");

let saveFlashTimer = null;

// ── Load / render ─────────────────────────────────────────────────────────────

async function load() {
  const data = await chrome.storage.local.get({
    enabled: false,
    intervalMinutes: 5,
    newChatUrl: "",
    chatMessage: "",
    lastCheckAt: 0,
    lastCheckResult: "",
    lastTriggerAt: 0,
    lastError: "",
  });
  enabledEl.checked      = data.enabled;
  intervalEl.value       = data.intervalMinutes;
  newChatUrlEl.value     = data.newChatUrl;
  chatMessageEl.value    = data.chatMessage;
  renderStatus(data);
}

function renderStatus(d) {
  const fmt = (t) => (t ? new Date(t).toLocaleString() : "—");
  statusEl.innerHTML = "";

  const text = document.createTextNode(
    `Last check:   ${fmt(d.lastCheckAt)}\n` +
    `Result:       ${d.lastCheckResult || "—"}\n` +
    `Last trigger: ${fmt(d.lastTriggerAt)}`
  );
  statusEl.appendChild(text);

  if (d.lastError) {
    const err = document.createElement("div");
    err.className = "err";
    err.textContent = `Error: ${d.lastError}`;
    statusEl.appendChild(err);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function flashSaved() {
  savedLabelEl.classList.add("show");
  clearTimeout(saveFlashTimer);
  saveFlashTimer = setTimeout(() => savedLabelEl.classList.remove("show"), 1500);
}

function isValidClaudeUrl(val) {
  if (!val) return true; // blank = use default
  try {
    const u = new URL(val);
    return u.protocol === "https:" && u.hostname === "claude.ai";
  } catch {
    return false;
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────

enabledEl.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: enabledEl.checked });
});

intervalEl.addEventListener("change", () => {
  let v = parseInt(intervalEl.value, 10);
  if (isNaN(v) || v < 1)  v = 1;
  if (v > 120)             v = 120;
  intervalEl.value = v;
  chrome.storage.local.set({ intervalMinutes: v });
});

newChatUrlEl.addEventListener("change", () => {
  const val = newChatUrlEl.value.trim();
  if (isValidClaudeUrl(val)) {
    newChatUrlEl.classList.remove("invalid");
    urlHintEl.className   = "hint";
    urlHintEl.textContent = "";
    chrome.storage.local.set({ newChatUrl: val });
    flashSaved();
  } else {
    newChatUrlEl.classList.add("invalid");
    urlHintEl.className   = "hint error";
    urlHintEl.textContent = "Must be a https://claude.ai/… URL";
  }
});

chatMessageEl.addEventListener("change", () => {
  chrome.storage.local.set({ chatMessage: chatMessageEl.value.trim() });
  flashSaved();
});

runBtn.addEventListener("click", async () => {
  runBtn.disabled    = true;
  runBtn.textContent = "Checking…";
  try {
    await chrome.runtime.sendMessage({ type: "RUN_NOW" });
  } finally {
    runBtn.disabled    = false;
    runBtn.textContent = "Run check now";
    load();
  }
});

// Refresh status whenever storage changes (e.g. background writes lastCheckAt).
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") load();
});

load();
