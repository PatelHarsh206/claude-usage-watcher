// background.js — orchestrates the usage check and triggers a new chat message.

const ALARM_NAME    = "claude-usage-check";
const USAGE_URL     = "https://claude.ai/settings/usage";
const DEFAULT_NEW_URL  = "https://claude.ai/new";
const DEFAULT_MESSAGE  = "hello";

// Multiple trigger texts — claude.ai UI copy can change; any match counts as idle.
const TRIGGER_TEXTS = [
  "Starts when a message is sent",
  "Usage resets",
  "Your usage resets",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Alarm management ──────────────────────────────────────────────────────────

async function updateAlarm() {
  const { enabled, intervalMinutes } = await chrome.storage.local.get({
    enabled: false,
    intervalMinutes: 5,
  });
  await chrome.alarms.clear(ALARM_NAME);
  if (enabled) {
    await chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: 0.1,
      periodInMinutes: Math.max(1, intervalMinutes),
    });
    console.log(`[ClaudeWatcher] monitoring every ${intervalMinutes} min`);
  } else {
    console.log("[ClaudeWatcher] monitoring stopped");
  }
}

chrome.runtime.onInstalled.addListener(updateAlarm);
chrome.runtime.onStartup.addListener(updateAlarm);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.enabled || changes.intervalMinutes) updateAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runCheck();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "RUN_NOW") {
    runCheck().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ── Tab helpers ───────────────────────────────────────────────────────────────

// Register the listener BEFORE checking current status to avoid the race where
// the tab loads between the create/update call and the listener registration.
function waitForTabLoad(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let done = false;

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    function listener(id, info) {
      if (id === tabId && info.status === "complete") finish();
    }

    const timer = setTimeout(finish, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);

    // In case the tab is already complete by the time we get here.
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab && tab.status === "complete") finish();
    });
  });
}

// ── Content injection ─────────────────────────────────────────────────────────

// Serialized and injected into the target page via executeScript({ func }).
// Must be fully self-contained — no outer-scope references.
async function injectSendMessage(message) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Wait for the ProseMirror editor to appear (up to ~16 s).
  let editor = null;
  for (let i = 0; i < 40; i++) {
    editor =
      document.querySelector('div.ProseMirror[contenteditable="true"]') ||
      document.querySelector('[contenteditable="true"][role="textbox"]');
    if (editor) break;
    await sleep(400);
  }
  if (!editor) return { ok: false, reason: "editor not found" };

  editor.focus();
  await sleep(200);

  // Select all existing content and delete it.
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  sel.removeAllRanges();
  sel.addRange(range);

  editor.dispatchEvent(
    new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentBackward" })
  );
  document.execCommand("delete");

  // Insert the message (beforeinput → execCommand → input covers both ProseMirror and React).
  editor.dispatchEvent(
    new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: message })
  );
  document.execCommand("insertText", false, message);
  editor.dispatchEvent(
    new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: message })
  );

  await sleep(800);

  // Try the send button first.
  const findSend = () =>
    document.querySelector('button[aria-label="Send message"]:not([disabled])') ||
    document.querySelector('button[aria-label="Send Message"]:not([disabled])') ||
    document.querySelector('button[aria-label*="send" i]:not([disabled])') ||
    document.querySelector('button[type="submit"]:not([disabled])');

  let sendBtn = findSend();
  for (let i = 0; i < 15 && !sendBtn; i++) {
    await sleep(300);
    sendBtn = findSend();
  }

  if (sendBtn) {
    sendBtn.click();
    return { ok: true, method: "button" };
  }

  // Fallback: Enter key. `composed: true` is needed for shadow-DOM hosts.
  const enterProps = { key: "Enter", code: "Enter", keyCode: 13, which: 13,
                       bubbles: true, cancelable: true, composed: true };
  editor.dispatchEvent(new KeyboardEvent("keydown", enterProps));
  editor.dispatchEvent(new KeyboardEvent("keyup",   enterProps));
  return { ok: true, method: "enter-fallback" };
}

// ── Main check ────────────────────────────────────────────────────────────────

async function runCheck() {
  // Storage-based concurrency guard — survives service-worker restarts.
  // A run older than 3 min is considered stale (SW was killed mid-run).
  const { checkStartedAt = 0 } = await chrome.storage.local.get("checkStartedAt");
  const stale = Date.now() - checkStartedAt > 3 * 60 * 1000;
  if (checkStartedAt && !stale) {
    console.log("[ClaudeWatcher] already running, skipping");
    return;
  }
  await chrome.storage.local.set({ checkStartedAt: Date.now(), lastError: "" });

  console.log("[ClaudeWatcher] check at", new Date().toISOString());

  let tab;
  try {
    tab = await chrome.tabs.create({ url: USAGE_URL, active: false });
    await waitForTabLoad(tab.id);
    await sleep(3500); // let React hydrate

    // Check whether the usage window shows the idle state.
    let isReady = false;
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [TRIGGER_TEXTS],
        func: (needles) => needles.some((n) => document.body.innerText.includes(n)),
      });
      isReady = result?.result === true;
    } catch (e) {
      console.error("[ClaudeWatcher] usage-check script failed:", e);
    }

    console.log("[ClaudeWatcher] usage window idle?", isReady);
    await chrome.storage.local.set({
      lastCheckAt: Date.now(),
      lastCheckResult: isReady ? "idle" : "active-or-unknown",
    });

    if (!isReady) return; // tab is closed in finally

    // Navigate the same tab to the new-chat URL and send the message.
    const { newChatUrl, chatMessage } = await chrome.storage.local.get({
      newChatUrl: "",
      chatMessage: "",
    });
    const targetUrl = newChatUrl || DEFAULT_NEW_URL;
    const message   = chatMessage || DEFAULT_MESSAGE;

    await chrome.tabs.update(tab.id, { url: targetUrl, active: false });
    await waitForTabLoad(tab.id);
    await sleep(3000);

    const [scriptResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args:   [message],
      func:   injectSendMessage,
    });

    await chrome.storage.local.set({ lastTriggerAt: Date.now() });
    console.log("[ClaudeWatcher] message sent:", scriptResult?.result);

  } catch (e) {
    console.error("[ClaudeWatcher] error:", e);
    await chrome.storage.local.set({ lastError: e.message || String(e) });
  } finally {
    if (tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
    await chrome.storage.local.set({ checkStartedAt: 0 });
  }
}
