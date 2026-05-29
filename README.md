# Claude Usage Watcher

Chrome extension (Manifest V3) that polls `https://claude.ai/settings/usage` on a timer.
When that page shows the text **"Starts when a message is sent"** (meaning no usage
window is active), the extension opens `https://claude.ai/new` and submits the
message `hello`.

## Install (unpacked)

1. Unzip this folder somewhere on your computer.
2. Open `chrome://extensions/` in Chrome.
3. Toggle **Developer mode** on (top‑right).
4. Click **Load unpacked** and select this folder.
5. Click the extension icon in the toolbar, tick **Enable monitoring**, and
   set how often you want it to check. The first check runs right away.

You must be **logged into claude.ai** in the same browser profile.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest, permissions, entry points |
| `background.js` | Service worker; runs `chrome.alarms` and opens the usage tab |
| `content-new.js` | Injected into `/new`; types "hello" and clicks Send |
| `popup.html` / `popup.js` | Toggle UI |

## How it works

1. A `chrome.alarms` timer fires every *N* minutes.
2. The worker opens `claude.ai/settings/usage` in a background tab.
3. After the page hydrates, it checks `document.body.innerText` for the trigger phrase.
4. If found: the same tab is navigated to `claude.ai/new`, the content script
   types `hello` into the ProseMirror editor and clicks the Send button.
5. If not: the tab is closed and nothing happens until the next tick.

## Caveats

- **Selectors are fragile.** Claude.ai's HTML changes from time to time. If sending
  stops working, edit the selectors in `content-new.js` (search for `Send message`
  and `ProseMirror`).
- **Trigger string is hard‑coded.** If Anthropic rewords the usage page,
  edit `TRIGGER_TEXT` in `background.js`.
- **Minimum interval is 1 minute** (Chrome's alarm floor for packed extensions).
- You may want to add toolbar icons. Drop `icon16.png`, `icon48.png`,
  `icon128.png` next to `manifest.json` and add an `"icons"` block to the
  manifest if you do.
- Automating account activity may run afoul of claude.ai's terms — use on your
  own account at your own risk.
