(() => {
  if (window.__SIDENOTE_INSTALLED__) return;
  window.__SIDENOTE_INSTALLED__ = true;

  const adapters = [
    '[data-message-author-role="assistant"]',
    "model-response",
    '[data-testid="answer"]',
    '[data-content="ai-message"]',
    '[data-testid^="conversation-turn-"] .font-claude-response',
    '[data-testid^="conversation-turn-"] .standard-markdown',
  ];
  const assistantSelectors = adapters.join(",");
  const blockSelector = "p, h1, h2, h3, h4, li, pre, blockquote";
  const MAX_THREAD_MESSAGES = 12;
  const MAX_PROMPT_CHARS = 2_000;
  const MAX_STORED_MESSAGE_CHARS = 2_000;
  const MAX_ANSWER_CHARS = 6_000;
  const MAX_STORED_THREADS = 80;
  const incognitoContext = Boolean(chrome.extension?.inIncognitoContext);
  const privateThreadStorage = new Map();
  const state = {
    context: null,
    threadKey: null,
    thread: [],
    port: null,
    pending: false,
    savedSelection: null,
    openGeneration: 0,
    activeAnswer: null,
    persistenceDisabled: false,
  };
  const anchorBlocks = new WeakMap();
  const anchorActions = new WeakMap();
  const messageOrdinals = new WeakMap();
  const blockOrdinals = new WeakMap();
  const nextBlockOrdinals = new WeakMap();
  let nextMessageOrdinal = 0;
  let openAnchorMenu = null;
  let persistenceQueue = Promise.resolve();

  const shell = document.createElement("div");
  shell.id = "sidenote-extension-root";
  shell.style.cssText =
    "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483646!important;pointer-events:none!important;";
  document.documentElement.appendChild(shell);
  const root = shell.attachShadow({ mode: "closed" });
  root.innerHTML = `
  <style>
  :host{all:initial;color-scheme:dark;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#f2f2f2}*{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer;color:inherit}
  .toolbar{position:fixed;z-index:2;display:none;align-items:center;gap:8px;transform:translate(-50%,-115%);background:#f0f0f0;color:#080808;border:0;border-radius:9px;padding:5px 7px 5px 10px;box-shadow:0 8px 28px #0008;font-size:11px;font-weight:650;max-width:calc(100vw - 16px);white-space:normal;pointer-events:auto}.toolbar.show{display:flex}.toolbar button{border:0;border-radius:7px;background:#111;color:white;padding:7px 9px;font-weight:700}
  .panel{position:fixed;z-index:1;right:18px;top:76px;width:min(380px,calc(100vw - 24px));height:min(650px,calc(100vh - 94px));min-height:min(390px,calc(100vh - 94px));border:1px solid #292929;background:linear-gradient(155deg,#080808,#000);color:#f2f2f2;border-radius:15px;box-shadow:0 22px 70px #0009;display:flex;flex-direction:column;overflow:hidden;transform:translateX(18px);opacity:0;visibility:hidden;transition:transform .18s,opacity .18s,visibility .18s;pointer-events:auto}.panel.open{transform:none;opacity:1;visibility:visible}.head{padding:15px 15px 12px;border-bottom:1px solid #292929;display:flex;align-items:center;justify-content:space-between}.title{font-weight:700;font-size:14px}.sub{font-size:10px;color:#a0a0a0}.close{height:30px;width:30px;background:transparent;border:1px solid transparent;border-radius:8px;color:#aab5c5;font-size:19px}.close:hover{background:#ffffff0c;border-color:#292929}.context{margin:12px 12px 3px;background:#111;border:1px solid #303030;border-radius:10px;padding:9px 11px;color:#eee;font-size:11px;line-height:1.5;max-height:100px;overflow:auto}.label{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#bdbdbd;margin-bottom:3px}.messages{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:12px}.empty{margin:auto;text-align:center;max-width:220px;color:#a0a0a0;font-size:11px}.empty b{color:#ddd}.msg{max-width:94%;font-size:12px;line-height:1.65;overflow-wrap:anywhere}.msg.user{align-self:flex-end;background:#1b1b1b;border:1px solid #454545;color:#fff;border-radius:12px 12px 3px 12px;padding:8px 11px;white-space:pre-wrap}.msg.assistant{align-self:flex-start;color:#ddd;padding:2px 3px;white-space:pre-wrap}.msg.error{color:#ddd}.compose-wrap{padding:10px;border-top:1px solid #292929}.compose{display:flex;align-items:flex-end;gap:7px;border:1px solid #393939;background:#050505;border-radius:11px;padding:7px}.compose input{border:0;outline:0;color:#f2f2f2;background:transparent;flex:1;min-width:0;font-size:12px;padding:5px 3px}.compose input::placeholder{color:#888}.send{height:31px;width:34px;border:0;border-radius:8px;background:#f0f0f0;color:#050505;font-weight:800;font-size:16px}.hint{font-size:9px;color:#888;margin:6px 3px 0}.actions{padding:0 12px 11px;display:flex;justify-content:space-between}.action{border:0;background:none;color:#bdbdbd;font-size:10px;padding:3px 2px}.action:hover{color:#fff}.toast{position:fixed;bottom:18px;left:50%;transform:translate(-50%,8px);opacity:0;background:#171717;border:1px solid #444;border-radius:9px;padding:8px 12px;color:#f2f2f2;font:11px system-ui;pointer-events:none;transition:.18s}.toast.show{opacity:1;transform:translate(-50%,0)}
  @media(max-width:650px){.panel{right:0;top:auto;bottom:0;width:100vw;height:min(78vh,690px);min-height:min(370px,calc(100vh - 16px));border-radius:17px 17px 0 0;transform:translateY(14px)}.panel.open{transform:none}}
  </style>
  <div class="toolbar" id="toolbar"><span>Selected text</span><button id="askSelection">✦ Ask subchat</button></div>
  <aside class="panel" id="panel" aria-label="SideNote subchat" aria-hidden="true">
    <div class="head"><div><div class="title">Ask subchat</div><div class="sub">Attached to this part of the answer</div></div><button class="close" id="close" aria-label="Close subchat">×</button></div>
    <div class="context"><div class="label">Source passage</div><div id="quote">Select a passage to start.</div></div>
    <div class="messages" id="messages" aria-live="polite"><div class="empty"><b>Ask a focused follow-up</b><br>Examples, a simpler explanation, or more detail.</div></div>
    <div class="compose-wrap"><form class="compose" id="form"><input id="prompt" maxlength="2000" placeholder="Ask about this passage…" aria-label="Subchat question" autocomplete="off"><button class="send" aria-label="Send">↑</button></form><div class="hint">Only this passage, source message, and side thread are sent.</div></div>
    <div class="actions"><button class="action" id="continue">↗ Copy subchat summary</button><button class="action" id="clear">Clear subchat</button></div>
  </aside><div class="toast" id="toast" role="status"></div>`;
  const $ = (s) => root.querySelector(s);
  const panel = $("#panel"),
    toolbar = $("#toolbar"),
    quote = $("#quote"),
    messages = $("#messages"),
    prompt = $("#prompt"),
    toast = $("#toast");

  async function textHash(text) {
    const bytes = new TextEncoder().encode(
      text.normalize("NFC").replace(/\s+/g, " ").trim(),
    );
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .slice(0, 16)
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  }
  function visibleText(el) {
    return (el?.innerText || el?.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 12000);
  }
  function isLeafBlock(el) {
    return el.matches("pre") || !el.querySelector(blockSelector);
  }
  function leafBlocks(message) {
    return [...message.querySelectorAll(blockSelector)].filter(isLeafBlock);
  }
  function contextFor(block, selected = visibleText(block)) {
    const message = block.closest(assistantSelectors) || block;
    const blocks = leafBlocks(message);
    const i = Math.max(0, blocks.indexOf(block));
    const windowed = blocks.slice(
      Math.max(0, i - 1),
      Math.min(blocks.length, i + 2),
    );
    const heading = [...blocks.slice(0, i)]
      .reverse()
      .find((el) => /^H[1-4]$/.test(el.tagName));
    const parts = [
      heading && visibleText(heading),
      ...windowed.map((el) => visibleText(el).slice(0, 900)),
    ].filter(Boolean);
    return {
      selectedText: selected.slice(0, 2500),
      nearbyText: [...new Set(parts)].join("\n").slice(0, 3000),
    };
  }
  function hostIdentity(el, names) {
    for (const name of names) {
      const value = el.getAttribute(name);
      if (value) return value.slice(0, 180);
    }
    return "";
  }
  function indexMessage(message) {
    if (!messageOrdinals.has(message))
      messageOrdinals.set(message, nextMessageOrdinal++);
    if (!nextBlockOrdinals.has(message)) nextBlockOrdinals.set(message, 0);
  }
  function anchorIdentity(block, selected) {
    const message = block.closest(assistantSelectors) || block;
    indexMessage(message);
    if (!blockOrdinals.has(block)) {
      blockOrdinals.set(block, nextBlockOrdinals.get(message));
      nextBlockOrdinals.set(message, nextBlockOrdinals.get(message) + 1);
    }
    const messageId =
      hostIdentity(message, [
        "data-message-id",
        "data-turn-id",
        "data-testid",
        "id",
      ]) || `assistant-${messageOrdinals.get(message)}`;
    const blockId =
      hostIdentity(block, ["data-block-id", "data-testid", "id"]) ||
      `block-${blockOrdinals.get(block)}`;
    return textHash(selected).then(
      (hash) =>
        `sidenote:v2:${location.origin}${location.pathname}:${messageId}:${blockId}:${hash}`,
    );
  }
  async function extensionStorage(type, payload = {}) {
    if (incognitoContext) {
      if (type === "get") {
        return privateThreadStorage.has(payload.key)
          ? { [payload.key]: privateThreadStorage.get(payload.key) }
          : {};
      }
      if (type === "save-thread") {
        const storedIndex = privateThreadStorage.get("sidenote:index");
        const index = Array.isArray(storedIndex)
          ? storedIndex.filter(
              (entry) =>
                entry &&
                typeof entry.key === "string" &&
                entry.key.startsWith("sidenote:v2:") &&
                Number.isFinite(entry.updatedAt) &&
                entry.key !== payload.key,
            )
          : [];
        index.push({ key: payload.key, updatedAt: payload.updatedAt });
        index.sort((a, b) => a.updatedAt - b.updatedAt);
        const expired = index.splice(
          0,
          Math.max(0, index.length - MAX_STORED_THREADS),
        );
        privateThreadStorage.set(payload.key, {
          messages: payload.messages,
          updatedAt: payload.updatedAt,
        });
        privateThreadStorage.set("sidenote:index", index);
        expired.forEach((entry) => privateThreadStorage.delete(entry.key));
        return { ok: true };
      }
      throw new Error("Invalid temporary SideNote storage request.");
    }

    const result = await chrome.runtime.sendMessage({
      type: `sidenote:storage:${type}`,
      ...payload,
    });
    if (result?.error) throw new Error(result.error);
    return result || {};
  }
  function stopPending(reason = "[Response stopped.]") {
    if (!state.pending) return;
    state.pending = false;
    state.port?.disconnect();
    state.port = null;
    if (state.activeAnswer) state.activeAnswer.textContent = reason;
    state.activeAnswer = null;
    $("#form").querySelector("button").disabled = false;
    prompt.disabled = false;
    $("#continue").disabled = false;
    const last = state.thread[state.thread.length - 1];
    if (last?.role === "user") {
      state.thread.push({ role: "assistant", content: reason });
      trimThread();
      persist(state.threadKey, state.thread);
    }
  }
  async function openPanel(ctx, anchorElement) {
    stopPending("[Response stopped because the source passage changed.]");
    const generation = ++state.openGeneration;
    state.context = ctx;
    state.anchorElement = anchorElement || null;
    state.threadKey = null;
    $(".sub").textContent = incognitoContext
      ? "Private browsing · this thread is temporary"
      : "Attached to this part of the answer";
    quote.textContent = "“" + ctx.selectedText + "”";
    toolbar.classList.remove("show");
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    messages.innerHTML =
      '<div class="empty"><b>Loading this passage…</b></div>';
    state.thread = [];
    prompt.focus();
    try {
      const requestedKey = await anchorIdentity(
        anchorElement || document.activeElement,
        ctx.selectedText,
      );
      if (
        generation !== state.openGeneration ||
        !panel.classList.contains("open")
      )
        return;
      state.threadKey = requestedKey;
      const data = await extensionStorage("get", { key: requestedKey });
      if (
        generation !== state.openGeneration ||
        !panel.classList.contains("open")
      )
        return;
      const savedMessages = data[requestedKey]?.messages;
      state.thread = Array.isArray(savedMessages)
        ? savedMessages
            .filter(
              (item) =>
                item &&
                ["user", "assistant"].includes(item.role) &&
                typeof item.content === "string",
            )
            .map((item) => ({
              role: item.role,
              content: item.content.slice(0, MAX_STORED_MESSAGE_CHARS),
            }))
            .slice(-MAX_THREAD_MESSAGES)
        : [];
      renderHistory();
    } catch (error) {
      if (generation === state.openGeneration) {
        messages.innerHTML =
          '<div class="empty"><b>Could not open this subchat.</b><br>Secure hashing or local storage is unavailable.</div>';
        showToast("Could not load saved subchat.");
      }
    }
  }
  function renderHistory() {
    messages.innerHTML = "";
    if (!state.thread.length) {
      messages.innerHTML =
        '<div class="empty"><b>Ask a focused follow-up</b><br>Examples, a simpler explanation, or more detail.</div>';
      return;
    }
    for (const m of state.thread) {
      const n = document.createElement("div");
      n.className = "msg " + (m.role === "user" ? "user" : "assistant");
      n.textContent = m.content;
      messages.append(n);
    }
    messages.scrollTop = messages.scrollHeight;
  }
  function trimThread() {
    if (state.thread.length <= MAX_THREAD_MESSAGES) return;
    const excess = state.thread.length - MAX_THREAD_MESSAGES;
    state.thread = state.thread.slice(-MAX_THREAD_MESSAGES);
    for (const node of [...messages.querySelectorAll(".msg")].slice(0, excess))
      node.remove();
  }
  function persist(key = state.threadKey, turns = state.thread) {
    if (!key || state.persistenceDisabled) return Promise.resolve();
    const bounded = turns.slice(-MAX_THREAD_MESSAGES).map((m) => ({
      role: m.role,
      content: (m.content || "").slice(0, MAX_STORED_MESSAGE_CHARS),
    }));
    const now = Date.now();
    const write = async () => {
      if (state.persistenceDisabled) return;
      await extensionStorage("save-thread", {
        key,
        messages: bounded,
        updatedAt: now,
      });
    };
    persistenceQueue = persistenceQueue
      .then(write, write)
      .catch(() =>
        showToast("Could not save this subchat. Browser storage may be full."),
      );
    return persistenceQueue;
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (
      sender.id !== chrome.runtime.id ||
      message?.type !== "sidenote:forget-all"
    ) {
      return;
    }
    state.persistenceDisabled = true;
    state.pending = false;
    state.port?.disconnect();
    state.port = null;
    state.activeAnswer = null;
    state.thread = [];
    state.threadKey = null;
    privateThreadStorage.clear();
    renderHistory();
    persistenceQueue.then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: true }),
    );
    return true;
  });
  function showToast(text) {
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
  }
  function injectAnchor(block) {
    if (
      block.dataset.sidenoteAnchor ||
      block.closest("#sidenote-extension-root") ||
      !block.closest(assistantSelectors)
    )
      return;
    block.dataset.sidenoteAnchor = "1";
    const host = document.createElement("span");
    host.className = "anchor-host";
    host.style.cssText =
      "all:initial!important;display:block!important;position:relative!important;height:0!important;pointer-events:none!important;";
    host.setAttribute("aria-hidden", "false");
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML =
      '<style>:host{all:initial;display:block;position:relative;height:0;pointer-events:none;z-index:2}.trigger{position:absolute;top:2px;right:0;width:27px;height:23px;opacity:0;pointer-events:none;background:#080808;border:1px solid #393939;border-radius:7px;color:#ddd;font:700 17px/1 system-ui,sans-serif;box-shadow:0 3px 12px #0006;cursor:pointer;transition:opacity .12s}.menu{position:absolute;top:29px;right:0;display:none;min-width:145px;padding:4px;background:#0b0b0b;border:1px solid #393939;border-radius:8px;box-shadow:0 8px 26px #000a;pointer-events:auto}.menu.open{display:block}.item{position:static!important;width:100%;padding:7px 9px!important;border:0!important;border-radius:5px!important;background:transparent!important;color:#eee!important;text-align:left;font:500 11px/1.4 system-ui,sans-serif!important;box-shadow:none!important;cursor:pointer}.item:hover,.item:focus-visible{background:#202020!important;outline:none}.trigger:focus-visible{opacity:1;pointer-events:auto;outline:1px solid #aaa}:host(.visible) .trigger,:host(.menu-open) .trigger{opacity:1;pointer-events:auto}</style><button class="trigger" type="button" tabindex="-1" aria-label="More passage actions" aria-haspopup="menu" aria-expanded="false">···</button><div class="menu" role="menu"><button class="item" type="button" role="menuitem">Ask subchat</button></div>';
    const action = {
      host,
      trigger: shadow.querySelector(".trigger"),
      menu: shadow.querySelector(".menu"),
    };
    anchorBlocks.set(host, block);
    anchorActions.set(block, action);
    action.trigger.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const opening = !action.menu.classList.contains("open");
      closeAnchorMenus(host);
      if (opening) openAnchorMenu = action;
      else if (openAnchorMenu === action) openAnchorMenu = null;
      host.classList.add("visible");
      host.classList.toggle("menu-open", opening);
      action.menu.classList.toggle("open", opening);
      action.trigger.setAttribute("aria-expanded", String(opening));
      if (opening) action.menu.querySelector(".item").focus();
    });
    action.trigger.addEventListener("focus", () =>
      host.classList.add("visible"),
    );
    action.trigger.addEventListener("keydown", (e) => {
      if (e.altKey && ["ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        moveMessageAction(block, e.key === "ArrowDown" ? 1 : -1);
      } else if (["ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        const item = action.menu.querySelector(".item");
        if (!action.menu.classList.contains("open")) action.trigger.click();
        else item.focus();
      }
    });
    action.menu.querySelector(".item").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeAnchorMenus();
      openPanel(contextFor(block), block);
    });
    shadow.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        host.classList.remove("menu-open");
        action.menu.classList.remove("open");
        action.trigger.setAttribute("aria-expanded", "false");
        if (openAnchorMenu === action) openAnchorMenu = null;
        action.trigger.focus();
      } else if (
        ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) &&
        action.menu.classList.contains("open")
      ) {
        e.preventDefault();
        action.menu.querySelector(".item").focus();
      } else if (e.key === "Tab" && action.menu.classList.contains("open")) {
        host.classList.remove("menu-open");
        action.menu.classList.remove("open");
        action.trigger.setAttribute("aria-expanded", "false");
        if (openAnchorMenu === action) openAnchorMenu = null;
      }
    });
    block.appendChild(host);
  }
  function setMessageRovingAction(message, blocks) {
    const visible = blocks.find((block) =>
      anchorActions.get(block)?.trigger.matches(":focus"),
    );
    const first = visible || blocks[0];
    for (const block of blocks) {
      const action = anchorActions.get(block);
      if (action) action.trigger.tabIndex = block === first ? 0 : -1;
    }
  }
  function moveMessageAction(block, direction) {
    const message = block.closest(assistantSelectors);
    if (!message) return;
    const blocks = leafBlocks(message).filter((item) =>
      anchorActions.has(item),
    );
    if (!blocks.length && anchorActions.has(message)) blocks.push(message);
    const index = blocks.indexOf(block);
    const next = blocks[(index + direction + blocks.length) % blocks.length];
    if (!next) return;
    for (const item of blocks) {
      const action = anchorActions.get(item);
      if (action) action.trigger.tabIndex = item === next ? 0 : -1;
    }
    anchorActions.get(next).trigger.focus();
  }
  function closeAnchorMenus(except) {
    const action = openAnchorMenu;
    if (!action || action.host === except) return;
    action.host.classList.remove("menu-open");
    action.menu.classList.remove("open");
    action.trigger.setAttribute("aria-expanded", "false");
    openAnchorMenu = null;
  }
  document.addEventListener(
    "pointerover",
    (e) => {
      const target =
        e.target instanceof Element ? e.target : e.target?.parentElement;
      const block = target?.closest(blockSelector);
      if (!block || !anchorActions.has(block)) return;
      const related = e.relatedTarget;
      if (related instanceof Node && block.contains(related)) return;
      anchorActions.get(block).host.classList.add("visible");
    },
    true,
  );
  document.addEventListener(
    "pointerout",
    (e) => {
      const target =
        e.target instanceof Element ? e.target : e.target?.parentElement;
      const block = target?.closest(blockSelector);
      if (!block || !anchorActions.has(block)) return;
      const related = e.relatedTarget;
      if (related instanceof Node && block.contains(related)) return;
      const action = anchorActions.get(block);
      if (
        !action.menu.classList.contains("open") &&
        !action.trigger.matches(":focus")
      )
        action.host.classList.remove("visible");
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "touch") return;
      const target =
        e.target instanceof Element ? e.target : e.target?.parentElement;
      const block = target?.closest(blockSelector);
      if (!block || !anchorActions.has(block)) return;
      const action = anchorActions.get(block);
      action.host.classList.add("visible");
      clearTimeout(action.hideTimer);
      action.hideTimer = setTimeout(() => {
        if (
          !action.menu.classList.contains("open") &&
          !action.trigger.matches(":focus")
        )
          action.host.classList.remove("visible");
      }, 3500);
    },
    true,
  );
  document.addEventListener(
    "click",
    (e) => {
      const host = e
        .composedPath()
        .find(
          (node) =>
            node instanceof HTMLElement &&
            node.classList?.contains("anchor-host"),
        );
      if (!host) closeAnchorMenus();
    },
    true,
  );
  function scanMessage(msg) {
    if (!msg || msg.closest("#sidenote-extension-root")) return;
    indexMessage(msg);
    let blocks = [...msg.querySelectorAll(blockSelector)].filter(
      (el) =>
        !el.querySelector(blockSelector) || el.matches("pre,li,blockquote"),
    );
    if (!blocks.length && visibleText(msg)) blocks = [msg];
    for (const block of blocks) {
      if (!blockOrdinals.has(block)) {
        blockOrdinals.set(block, nextBlockOrdinals.get(msg));
        nextBlockOrdinals.set(msg, nextBlockOrdinals.get(msg) + 1);
      }
      injectAnchor(block);
    }
    setMessageRovingAction(msg, blocks);
  }
  function scan() {
    for (const msg of document.querySelectorAll(assistantSelectors))
      scanMessage(msg);
  }
  let scanTimer;
  const pendingMessages = new Set(),
    pendingBlocks = new Set();
  function collectMessages(node) {
    if (
      node.nodeType !== Node.ELEMENT_NODE ||
      node.classList.contains("anchor-host") ||
      node.closest("#sidenote-extension-root")
    )
      return;
    if (node.matches(assistantSelectors)) pendingMessages.add(node);
    for (const msg of node.querySelectorAll?.(assistantSelectors) || [])
      pendingMessages.add(msg);
  }
  function collectAdded(node, owner) {
    if (
      node.nodeType !== Node.ELEMENT_NODE ||
      node.classList.contains("anchor-host") ||
      node.closest("#sidenote-extension-root")
    )
      return;
    if (
      node.matches(blockSelector) &&
      isLeafBlock(node) &&
      node.closest(assistantSelectors) === owner
    )
      pendingBlocks.add(node);
    for (const block of node.querySelectorAll?.(blockSelector) || [])
      if (block.closest(assistantSelectors) === owner && isLeafBlock(block))
        pendingBlocks.add(block);
    collectMessages(node);
  }
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target =
        record.target.nodeType === Node.ELEMENT_NODE
          ? record.target
          : record.target.parentElement;
      if (
        !target ||
        target.closest("#sidenote-extension-root") ||
        target.classList?.contains("anchor-host")
      )
        continue;
      const msg = target.closest(assistantSelectors);
      if (msg) {
        if (record.type === "characterData") {
          const block = target.closest(blockSelector);
          if (block) pendingBlocks.add(block);
          else pendingMessages.add(msg);
        } else {
          for (const n of record.addedNodes) collectAdded(n, msg);
          if (!record.addedNodes.length) pendingMessages.add(msg);
        }
      } else for (const n of record.addedNodes) collectMessages(n);
    }
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      const changedMessages = new Set(pendingMessages);
      for (const block of pendingBlocks) {
        injectAnchor(block);
        const msg = block.closest(assistantSelectors);
        if (msg) changedMessages.add(msg);
      }
      for (const msg of changedMessages) {
        let blocks = leafBlocks(msg);
        if (!blocks.length && visibleText(msg)) blocks = [msg];
        setMessageRovingAction(msg, blocks);
      }
      pendingMessages.clear();
      pendingBlocks.clear();
    }, 180);
  });
  observer.observe(document.body, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  scan();

  function selectionContext() {
    const sel = getSelection();
    const selected = sel?.toString().trim();
    if (!selected || !sel.rangeCount || !document.body.contains(sel.anchorNode))
      return null;
    const node =
      sel.anchorNode.nodeType === Node.ELEMENT_NODE
        ? sel.anchorNode
        : sel.anchorNode.parentElement;
    const block = node?.closest(blockSelector);
    const msg = node?.closest(assistantSelectors);
    if (!block || !msg) return null;
    return { context: contextFor(block, selected), block };
  }
  function updateToolbar() {
    const result = selectionContext();
    if (!result) {
      toolbar.classList.remove("show");
      state.savedSelection = null;
      state.savedBlock = null;
      return;
    }
    state.savedSelection = result.context;
    state.savedBlock = result.block;
    const r = getSelection().getRangeAt(0).getBoundingClientRect();
    toolbar.style.left =
      Math.max(8, Math.min(innerWidth - 8, r.left + r.width / 2)) + "px";
    toolbar.style.top = Math.max(55, r.top) + "px";
    toolbar.classList.add("show");
  }
  document.addEventListener(
    "mouseup",
    () => setTimeout(updateToolbar, 0),
    true,
  );
  document.addEventListener(
    "pointerup",
    () => setTimeout(updateToolbar, 0),
    true,
  );
  document.addEventListener(
    "keyup",
    (e) => {
      if (
        ["Shift", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
          e.key,
        )
      )
        updateToolbar();
    },
    true,
  );
  $("#askSelection").addEventListener("click", () => {
    if (state.savedSelection) openPanel(state.savedSelection, state.savedBlock);
  });
  document.addEventListener(
    "mousedown",
    (e) => {
      if (!e.composedPath().includes(shell)) {
        toolbar.classList.remove("show");
        state.savedSelection = null;
        state.savedBlock = null;
      }
    },
    true,
  );
  function closePanel() {
    stopPending("[Response stopped because the panel was closed.]");
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    const trigger = anchorActions.get(state.anchorElement)?.trigger;
    if (trigger?.isConnected) trigger.focus();
  }
  $("#close").addEventListener("click", closePanel);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (panel.classList.contains("open")) closePanel();
      else toolbar.classList.remove("show");
    }
  });

  function sendQuestion(question) {
    const q = question.trim().slice(0, MAX_PROMPT_CHARS);
    if (!q || state.pending) return;
    if (!state.context) {
      showToast("Choose a passage first.");
      return;
    }
    messages.querySelector(".empty")?.remove();
    state.thread.push({ role: "user", content: q });
    const user = document.createElement("div");
    user.className = "msg user";
    user.textContent = q;
    messages.append(user);
    const answer = document.createElement("div");
    answer.className = "msg assistant";
    answer.textContent = "";
    messages.append(answer);
    state.activeAnswer = answer;
    trimThread();
    messages.scrollTop = messages.scrollHeight;
    state.pending = true;
    $("#form").querySelector("button").disabled = true;
    prompt.disabled = true;
    $("#continue").disabled = true;
    persist();
    let port;
    try {
      port = chrome.runtime.connect({ name: "sidenote-chat-v1" });
    } catch {
      state.pending = false;
      state.activeAnswer = null;
      $("#form").querySelector("button").disabled = false;
      prompt.disabled = false;
      $("#continue").disabled = false;
      answer.textContent =
        "The SideNote service worker is unavailable. Reload the page and try again.";
      state.thread.push({ role: "assistant", content: answer.textContent });
      trimThread();
      persist();
      return;
    }
    state.port = port;
    port.onMessage.addListener((msg) => {
      if (state.port !== port) return;
      if (msg.type === "delta") {
        const room = MAX_ANSWER_CHARS - answer.textContent.length;
        if (room > 0) answer.textContent += msg.text.slice(0, room);
        messages.scrollTop = messages.scrollHeight;
        if (answer.textContent.length >= MAX_ANSWER_CHARS) {
          answer.textContent = answer.textContent.slice(0, MAX_ANSWER_CHARS);
          state.thread.push({ role: "assistant", content: answer.textContent });
          trimThread();
          state.pending = false;
          state.port = null;
          state.activeAnswer = null;
          $("#form").querySelector("button").disabled = false;
          prompt.disabled = false;
          $("#continue").disabled = false;
          persist();
          port.disconnect();
        }
      } else if (msg.type === "done") {
        state.pending = false;
        state.port = null;
        state.activeAnswer = null;
        $("#form").querySelector("button").disabled = false;
        prompt.disabled = false;
        $("#continue").disabled = false;
        port.disconnect();
        if (!answer.textContent)
          answer.textContent = "The model returned an empty response.";
        state.thread.push({ role: "assistant", content: answer.textContent });
        trimThread();
        persist();
      } else if (msg.type === "error") {
        state.pending = false;
        state.port = null;
        state.activeAnswer = null;
        $("#form").querySelector("button").disabled = false;
        prompt.disabled = false;
        $("#continue").disabled = false;
        port.disconnect();
        answer.classList.add("error");
        answer.textContent = msg.message;
        state.thread.push({
          role: "assistant",
          content: `[Connection error] ${msg.message}`,
        });
        trimThread();
        persist();
      }
    });
    port.onDisconnect.addListener(() => {
      if (state.pending) {
        state.pending = false;
        state.port = null;
        if (state.activeAnswer) {
          state.activeAnswer.textContent =
            "[Connection closed before the reply completed.]";
        }
        state.activeAnswer = null;
        $("#form").querySelector("button").disabled = false;
        prompt.disabled = false;
        $("#continue").disabled = false;
        state.thread.push({
          role: "assistant",
          content: "[Connection closed before the reply completed.]",
        });
        trimThread();
        persist();
      }
    });
    port.postMessage({
      type: "chat",
      context: state.context,
      history: state.thread
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) })),
    });
  }
  $("#form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = prompt.value;
    prompt.value = "";
    sendQuestion(q);
  });
  $("#clear").addEventListener("click", () => {
    if (state.pending) {
      state.pending = false;
      state.port?.disconnect();
      state.port = null;
      $("#form").querySelector("button").disabled = false;
      prompt.disabled = false;
      $("#continue").disabled = false;
    }
    state.activeAnswer = null;
    state.thread = [];
    persist();
    renderHistory();
    showToast("Subchat cleared.");
  });
  $("#continue").addEventListener("click", async () => {
    if (!state.thread.length) {
      showToast("Ask a side question before copying its summary.");
      return;
    }
    const summary = `Passage: ${state.context.selectedText}\n\nSide conversation:\n${state.thread
      .slice(-4)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n")}`;
    try {
      await navigator.clipboard.writeText(summary);
      showToast(
        "Subchat summary copied. Paste it into the main chat when ready.",
      );
    } catch {
      showToast(
        "Clipboard access was blocked. Select and copy the side-thread text manually.",
      );
    }
  });
})();
