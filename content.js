const STORAGE_KEY = "items";

function clip(text, max) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

function firstSentence(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const cut = normalized.split(/[。！？!?\n]/)[0].trim();
  return clip(cut || normalized, 80);
}

function tweetKey(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url, location.origin);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const statusAt = parts.indexOf("status");
    if (statusAt > 0 && parts[statusAt + 1]) {
      return `${parts[statusAt - 1].toLowerCase()}/${parts[statusAt + 1]}`;
    }
  } catch (error) {
    return "";
  }
  return "";
}

let savedUrls = new Set();
let followedHandles = new Set();

function applyItems(items) {
  savedUrls = new Set();
  if (!Array.isArray(items)) return;
  items.forEach((item) => {
    const key = tweetKey(item && item.url);
    if (key) savedUrls.add(key);
  });
}

function applyFollows(follows) {
  followedHandles = new Set();
  if (!Array.isArray(follows)) return;
  follows.forEach((item) => {
    if (item && item.handle) followedHandles.add(String(item.handle).toLowerCase());
  });
}

function readTweet(article) {
  const textNode = article.querySelector('[data-testid="tweetText"]');
  const excerpt = clip(textNode ? textNode.innerText : "", 280);
  const time = article.querySelector("time");
  const link = time && time.closest("a");
  const href = link && link.getAttribute("href");
  let url = location.href.split("?")[0];
  let author = "";

  if (href) {
    const parsed = new URL(href, location.origin);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const statusAt = parts.indexOf("status");
    if (statusAt > 0 && parts[statusAt + 1]) {
      author = `@${parts[statusAt - 1]}`;
      url = `${parsed.origin}/${parts[statusAt - 1]}/status/${parts[statusAt + 1]}`;
    }
  }

  const sentence = firstSentence(excerpt) || (author ? `${author} 的一条帖子` : "一条帖子");
  return { excerpt, sentence, url, author };
}

function findMount(article) {
  const reply = article.querySelector('[data-testid="reply"]');
  const group = reply && reply.closest('[role="group"]');
  if (group && group.parentElement) {
    return { parent: group.parentElement, after: group };
  }
  return { parent: article, after: null };
}

function place(parent, after, node) {
  if (after && after.parentElement === parent) {
    after.insertAdjacentElement("afterend", node);
    return;
  }
  parent.append(node);
}

function closeEditors() {
  document.querySelectorAll(".x-todo-editor").forEach((editor) => editor.remove());
}

function isInvalidContext(error) {
  const message = String((error && error.message) || error || "");
  return message.indexOf("context invalidated") !== -1;
}

function pageAlive() {
  try {
    return Boolean(chrome.runtime && chrome.runtime.id);
  } catch (error) {
    return false;
  }
}

async function saveItem(tweet, text) {
  try {
    if (!pageAlive() || !chrome.storage || !chrome.storage.local) {
      throw new Error("storage-unavailable");
    }
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const items = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
    const key = tweetKey(tweet.url);
    if (key && items.some((item) => tweetKey(item.url) === key)) return;
    items.push({
      id: crypto.randomUUID(),
      text,
      excerpt: tweet.excerpt,
      url: tweet.url,
      author: tweet.author,
      createdAt: Date.now(),
      done: false,
    });
    await chrome.storage.local.set({ [STORAGE_KEY]: items });
  } catch (error) {
    if (isInvalidContext(error)) shutdown();
    throw new Error("storage-unavailable");
  }
}

function showNote(wrap, message, className) {
  wrap.querySelectorAll(".x-todo-note").forEach((note) => note.remove());
  const note = document.createElement("span");
  note.className = `x-todo-note ${className}`;
  note.textContent = message;
  wrap.append(note);
  window.setTimeout(() => note.remove(), 1600);
}

function openEditor(wrap, article) {
  closeEditors();
  const tweet = readTweet(article);
  const editor = document.createElement("div");
  editor.className = "x-todo-editor";

  const input = document.createElement("input");
  input.className = "x-todo-input";
  input.type = "text";
  input.maxLength = 120;
  input.autocomplete = "off";
  input.setAttribute("aria-label", "我要做的事");
  input.value = tweet.sentence;

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "x-todo-save";
  saveButton.textContent = "保存";

  let saving = false;
  async function save() {
    if (saving) return;
    if (wrap.dataset.tweetKey && savedUrls.has(wrap.dataset.tweetKey)) {
      editor.remove();
      paintTweet(wrap);
      showNote(wrap, "这条已在待办里", "is-saved");
      return;
    }
    const text = input.value.trim() || tweet.sentence;
    if (!text) return;
    saving = true;
    saveButton.disabled = true;
    try {
      await saveItem(tweet, clip(text, 120));
      if (wrap.dataset.tweetKey) savedUrls.add(wrap.dataset.tweetKey);
      editor.remove();
      paintTweet(wrap);
      showNote(wrap, "已记下", "is-saved");
    } catch (error) {
      saving = false;
      saveButton.disabled = false;
      const message =
        error && error.message === "storage-unavailable"
          ? "没记下。请先在扩展卡片上点刷新，再刷新本页"
          : "没记下，请刷新页面后再试";
      showNote(wrap, message, "is-error");
    }
  }

  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      editor.remove();
    }
  });
  saveButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    save();
  });

  editor.append(input, saveButton);
  wrap.append(editor);
  input.focus();
  input.select();
}

function attach(article) {
  if (!(article instanceof HTMLElement)) return;
  if (article.querySelector(".x-todo-wrap")) return;

  const wrap = document.createElement("div");
  wrap.className = "x-todo-wrap";
  wrap.addEventListener("pointerdown", (event) => event.stopPropagation());
  wrap.addEventListener("click", (event) => event.stopPropagation());

  const tweet = readTweet(article);
  const authorHandle = XTodoFollows.parseHandle(tweet.author);
  wrap.dataset.tweetKey = tweetKey(tweet.url);
  if (authorHandle) wrap.dataset.author = authorHandle;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "x-todo-btn";
  button.dataset.role = "save";
  button.textContent = "记成待办";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const editor = wrap.querySelector(".x-todo-editor");
    if (editor) {
      editor.remove();
      paintTweet(wrap);
      return;
    }
    if (wrap.dataset.tweetKey && savedUrls.has(wrap.dataset.tweetKey)) {
      showNote(wrap, "这条已在待办里", "is-saved");
      return;
    }
    openEditor(wrap, article);
  });

  wrap.append(button);

  if (authorHandle) {
    const followButton = document.createElement("button");
    followButton.type = "button";
    followButton.className = "x-todo-btn";
    followButton.dataset.role = "follow";
    followButton.textContent = "关注作者";
    followButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      followButton.disabled = true;
      try {
        const result = await XTodoFollows.addFollow(authorHandle, readAuthorName(article));
        followedHandles.add(authorHandle.toLowerCase());
        followButton.disabled = false;
        paintTweet(wrap);
        showNote(wrap, result === "exists" ? "已在关注里" : "已加入关注", "is-saved");
      } catch (error) {
        followButton.disabled = false;
        const message =
          error && error.message === "storage-unavailable"
            ? "没加入。请先在扩展卡片上点刷新，再刷新本页"
            : "没加入，请刷新页面后再试";
        showNote(wrap, message, "is-error");
      }
    });
    wrap.append(followButton);
  }

  paintTweet(wrap);

  const mount = findMount(article);
  place(mount.parent, mount.after, wrap);
}

function firstDisplayName(root) {
  if (!root) return "";
  const line = root.innerText
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item && item !== "·" && !item.startsWith("@") && !XTodoFollows.isUiLabel(item));
  return line || "";
}

function nameFromTitle(handle) {
  const title = (document.title || "").replace(/\s*[\/|]\s*X\s*$/i, "").trim();
  if (!title || !handle) return "";
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = title.match(new RegExp(`^(.+?)\\s*[（(]\\s*@${escaped}\\s*[)）]`, "i"));
  return match && match[1] ? match[1].trim() : "";
}

function readAuthorName(article) {
  return firstDisplayName(article.querySelector('[data-testid="User-Name"]'));
}

function profileHandleFromLocation() {
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts.length !== 1) return null;
  return XTodoFollows.parseHandle(parts[0]);
}

function readProfileName() {
  const handle = profileHandleFromLocation();
  const fromNode = firstDisplayName(document.querySelector('[data-testid="UserName"]'));
  if (fromNode) return fromNode;
  const fromTitle = nameFromTitle(handle);
  if (fromTitle && !XTodoFollows.isUiLabel(fromTitle)) return fromTitle;
  return "";
}

let profileMounting = "";

async function mountProfile(handle) {
  const nameNode = document.querySelector('[data-testid="UserName"]');
  const column = document.querySelector('[data-testid="primaryColumn"]');
  if (!nameNode && !column) return;

  const wrap = document.createElement("div");
  wrap.className = "x-follow-wrap";
  wrap.dataset.handle = handle;
  wrap.addEventListener("pointerdown", (event) => event.stopPropagation());
  wrap.addEventListener("click", (event) => event.stopPropagation());

  const button = document.createElement("button");
  button.type = "button";
  button.className = "x-todo-btn";
  button.textContent = "加入关注";
  const follows = await XTodoFollows.loadFollows();
  const profileName = readProfileName();
  if (follows && follows.some((item) => XTodoFollows.sameHandle(item.handle, handle))) {
    followedHandles.add(handle.toLowerCase());
    if (profileName) XTodoFollows.addFollow(handle, profileName).catch(() => {});
  }
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    try {
      const result = await XTodoFollows.addFollow(handle, readProfileName());
      followedHandles.add(handle.toLowerCase());
      button.disabled = false;
      paintProfile();
      showNote(wrap, result === "exists" ? "已在关注里" : "已加入关注", "is-saved");
    } catch (error) {
      button.disabled = false;
      const message =
        error && error.message === "storage-unavailable"
          ? "没加入。请先在扩展卡片上点刷新，再刷新本页"
          : "没加入，请刷新页面后再试";
      showNote(wrap, message, "is-error");
    }
  });
  wrap.append(button);

  const current = profileHandleFromLocation();
  if (!current || !XTodoFollows.sameHandle(current, handle)) return;
  const liveName = document.querySelector('[data-testid="UserName"]');
  const liveColumn = document.querySelector('[data-testid="primaryColumn"]');
  if (liveName) {
    liveName.insertAdjacentElement("afterend", wrap);
  } else if (liveColumn) {
    liveColumn.prepend(wrap);
  } else {
    return;
  }
  paintProfile();
}

function scanProfile() {
  const handle = profileHandleFromLocation();
  const existing = document.querySelector(".x-follow-wrap");
  if (!handle) {
    if (existing) existing.remove();
    profileMounting = "";
    return;
  }
  if (existing && XTodoFollows.sameHandle(existing.dataset.handle, handle)) {
    scheduleNameBackfill();
    return;
  }
  if (XTodoFollows.sameHandle(profileMounting, handle)) return;
  if (existing) existing.remove();
  profileMounting = handle;
  mountProfile(handle)
    .catch((error) => {
      if (isInvalidContext(error)) shutdown();
    })
    .finally(() => {
      if (XTodoFollows.sameHandle(profileMounting, handle)) profileMounting = "";
    });
}

function collectVisibleNames() {
  const pairs = [];
  const profileHandle = profileHandleFromLocation();
  const profileName = readProfileName();
  if (profileHandle && profileName) pairs.push({ handle: profileHandle, name: profileName });
  document.querySelectorAll('article[data-testid="tweet"]').forEach((article) => {
    const handle = XTodoFollows.parseHandle(readTweet(article).author);
    const name = readAuthorName(article);
    if (handle && name) pairs.push({ handle, name });
  });
  return pairs;
}

let backfillTimer = 0;
let observer = null;
let stopped = false;

function shutdown() {
  if (stopped) return;
  stopped = true;
  if (observer) observer.disconnect();
  if (backfillTimer) {
    window.clearTimeout(backfillTimer);
    backfillTimer = 0;
  }
}

function scheduleNameBackfill() {
  if (stopped || backfillTimer) return;
  backfillTimer = window.setTimeout(() => {
    backfillTimer = 0;
    if (stopped || !pageAlive()) {
      shutdown();
      return;
    }
    const pairs = collectVisibleNames();
    if (!pairs.length) return;
    XTodoFollows.applyFollowNames(pairs).catch((error) => {
      if (isInvalidContext(error)) shutdown();
    });
  }, 500);
}

function scan() {
  if (stopped || !pageAlive()) {
    shutdown();
    return;
  }
  document.querySelectorAll('article[data-testid="tweet"]').forEach(attach);
  scanProfile();
  scheduleNameBackfill();
}

let scheduled = false;
function scheduleScan() {
  if (stopped || scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    scan();
  });
}

window.addEventListener("unhandledrejection", (event) => {
  if (!isInvalidContext(event.reason)) return;
  event.preventDefault();
  shutdown();
});

function paintTweet(wrap) {
  const saveBtn = wrap.querySelector('[data-role="save"]');
  const followBtn = wrap.querySelector('[data-role="follow"]');
  const saved = Boolean(wrap.dataset.tweetKey) && savedUrls.has(wrap.dataset.tweetKey);
  if (saveBtn) {
    saveBtn.textContent = saved ? "已记成待办" : "记成待办";
    saveBtn.classList.toggle("is-done", saved);
  }
  const author = String(wrap.dataset.author || "").toLowerCase();
  const followed = Boolean(author) && followedHandles.has(author);
  if (followBtn) {
    followBtn.textContent = followed ? "已关注" : "关注作者";
    followBtn.classList.toggle("is-done", followed);
  }
}

function paintProfile() {
  const wrap = document.querySelector(".x-follow-wrap");
  if (!wrap) return;
  const button = wrap.querySelector(".x-todo-btn");
  const handle = String(wrap.dataset.handle || "").toLowerCase();
  if (!button || !handle) return;
  const followed = followedHandles.has(handle);
  button.textContent = followed ? "已关注" : "加入关注";
  button.classList.toggle("is-done", followed);
}

function paintAll() {
  document.querySelectorAll(".x-todo-wrap").forEach(paintTweet);
  paintProfile();
}

function watchStorage() {
  if (!pageAlive() || !chrome.storage || !chrome.storage.onChanged) return;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (stopped || area !== "local") return;
    if (!pageAlive()) {
      shutdown();
      return;
    }
    if (Object.prototype.hasOwnProperty.call(changes, "items")) applyItems(changes.items.newValue);
    if (Object.prototype.hasOwnProperty.call(changes, "follows")) applyFollows(changes.follows.newValue);
    paintAll();
  });
}

function loadMarks() {
  if (!pageAlive() || !chrome.storage || !chrome.storage.local) return;
  chrome.storage.local.get(["items", "follows"]).then((stored) => {
    if (stopped || !pageAlive()) return;
    applyItems(stored.items);
    applyFollows(stored.follows);
    paintAll();
  }).catch((error) => {
    if (isInvalidContext(error)) shutdown();
  });
}

watchStorage();
loadMarks();
scheduleScan();
observer = new MutationObserver(scheduleScan);
observer.observe(document.documentElement, { childList: true, subtree: true });
