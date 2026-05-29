// content-new.js — standalone reference / manual-test version.
// The production path inlines this logic via executeScript({ func: injectSendMessage })
// in background.js, which allows passing the message as an argument and properly
// awaiting the async result before closing the tab.
//
// To test manually: open DevTools on claude.ai/new, paste and run this file.

(async () => {
  const MESSAGE = "hello"; // change for manual testing
  const sleep   = (ms) => new Promise((r) => setTimeout(r, ms));

  let editor = null;
  for (let i = 0; i < 40; i++) {
    editor =
      document.querySelector('div.ProseMirror[contenteditable="true"]') ||
      document.querySelector('[contenteditable="true"][role="textbox"]');
    if (editor) break;
    await sleep(400);
  }
  if (!editor) { console.error("[ClaudeWatcher] editor not found"); return; }

  editor.focus();
  await sleep(200);

  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  sel.removeAllRanges();
  sel.addRange(range);

  editor.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentBackward" }));
  document.execCommand("delete");

  editor.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: MESSAGE }));
  document.execCommand("insertText", false, MESSAGE);
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: MESSAGE }));

  await sleep(800);

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
    console.log("[ClaudeWatcher] sent via button click");
    return;
  }

  const enterProps = { key: "Enter", code: "Enter", keyCode: 13, which: 13,
                       bubbles: true, cancelable: true, composed: true };
  editor.dispatchEvent(new KeyboardEvent("keydown", enterProps));
  editor.dispatchEvent(new KeyboardEvent("keyup",   enterProps));
  console.log("[ClaudeWatcher] sent via Enter fallback");
})();
