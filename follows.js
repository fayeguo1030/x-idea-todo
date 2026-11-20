function followsKey() {
  return "follows";
}

function reservedHandles() {
  return new Set([
    "home",
    "explore",
    "notifications",
    "messages",
    "settings",
    "search",
    "compose",
    "login",
    "signup",
    "logout",
    "i",
    "intent",
    "share",
    "download",
    "jobs",
    "privacy",
    "tos",
    "account",
    "hashtag",
    "lists",
    "communities",
    "premium",
    "bookmarks",
    "topics",
    "oauth",
    "oauth2",
    "sessions",
    "live",
  ]);
}

function sameHandle(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function parseHandle(input) {
  if (typeof input !== "string") return null;
  let value = input.trim();
  if (!value) return null;
  value = value.replace(/^@+/, "");
  if (/^(https?:\/\/)?(www\.)?(x|twitter)\.com\//i.test(value)) {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      const url = new URL(withProtocol);
      const host = url.hostname.replace(/^www\./, "").toLowerCase();
      if (host !== "x.com" && host !== "twitter.com") return null;
      value = url.pathname.split("/").filter(Boolean)[0] || "";
    } catch (error) {
      return null;
    }
  }
  if (!/^[A-Za-z0-9_]{1,15}$/.test(value)) return null;
  if (reservedHandles().has(value.toLowerCase())) return null;
  return value;
}

function profileUrl(handle) {
  return `https://x.com/${handle}`;
}

function isUiLabel(name) {
  const text = String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
  return [
    "个人资料",
    "profile",
    "posts",
    "帖子",
    "replies",
    "回复",
    "highlights",
    "亮点",
    "articles",
    "文章",
    "media",
    "媒体",
    "likes",
    "喜欢",
    "followers",
    "following",
    "关注",
    "正在关注",
    "已关注",
    "subscribe",
    "订阅",
    "verified",
    "认证",
    "home",
    "主页",
    "search",
    "搜索",
  ].some((label) => text === label.toLowerCase());
}

function cleanFollowName(name, handle) {
  let text = String(name || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (handle) {
    const escaped = String(handle).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`\\s*@+${escaped}\\s*$`, "i"), "").trim();
  }
  text = text.replace(/^@+/, "").trim();
  if (!text || isUiLabel(text)) return "";
  return [...text].length > 40 ? `${[...text].slice(0, 40).join("")}…` : text;
}

function storageAvailable() {
  try {
    return Boolean(chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.local);
  } catch (error) {
    return false;
  }
}

async function loadFollows() {
  if (!storageAvailable()) return null;
  try {
    const stored = await chrome.storage.local.get(followsKey());
    const follows = stored[followsKey()];
    return Array.isArray(follows) ? follows : [];
  } catch (error) {
    return null;
  }
}

async function storeFollows(follows) {
  if (!storageAvailable()) throw new Error("storage-unavailable");
  try {
    await chrome.storage.local.set({ [followsKey()]: follows });
  } catch (error) {
    throw new Error("storage-unavailable");
  }
}

async function applyFollowNames(pairs) {
  const follows = await loadFollows();
  if (!follows || !Array.isArray(pairs) || !pairs.length) return false;
  let changed = false;
  const next = follows.map((item) => {
    const found = pairs.find((pair) => pair && sameHandle(pair.handle, item.handle));
    if (!found) return item;
    const cleaned = cleanFollowName(found.name, item.handle);
    if (!cleaned) return item;
    if (item.name && !isUiLabel(item.name)) return item;
    if (item.name === cleaned) return item;
    changed = true;
    return { ...item, name: cleaned };
  });
  if (!changed) return false;
  await storeFollows(next);
  return true;
}

async function addFollow(handle, name) {
  const follows = await loadFollows();
  if (!follows) throw new Error("storage-unavailable");
  const cleanedName = cleanFollowName(name, handle);
  const index = follows.findIndex((item) => sameHandle(item.handle, handle));
  if (index >= 0) {
    if (cleanedName && (!follows[index].name || isUiLabel(follows[index].name))) {
      const next = follows.slice();
      next[index] = { ...next[index], name: cleanedName };
      await storeFollows(next);
    }
    return "exists";
  }
  follows.push({
    id: crypto.randomUUID(),
    handle,
    name: cleanedName,
    addedAt: Date.now(),
  });
  await storeFollows(follows);
  return "added";
}

globalThis.XTodoFollows = {
  parseHandle,
  profileUrl,
  sameHandle,
  isUiLabel,
  loadFollows,
  storeFollows,
  addFollow,
  applyFollowNames,
};
