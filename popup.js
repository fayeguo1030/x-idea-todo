const list = document.querySelector("#list");
const doneList = document.querySelector("#done-list");
const doneToggle = document.querySelector("#done-toggle");
const empty = document.querySelector("#empty");
const hint = document.querySelector("#hint");
let showDone = false;
let latestItems = [];

function ageLabel(item) {
  const elapsed = Date.now() - item.createdAt;
  const days = Math.floor(elapsed / 86400000);
  if (!item.done && elapsed >= OVERDUE_MS) return `已放 ${Math.max(days, 2)} 天`;
  if (days <= 0) return "今天";
  return `${days} 天`;
}

function appendItem(parent, item) {
  const overdue = !item.done && Date.now() - item.createdAt >= OVERDUE_MS;
  const row = document.createElement("li");
  row.className = item.done ? "item done" : overdue ? "item is-overdue" : "item";
  row.dataset.id = item.id;

  const text = document.createElement("p");
  text.className = "text";
  text.textContent = item.text || "";
  if (item.excerpt) text.title = item.excerpt;

  const meta = document.createElement("p");
  meta.className = "meta";
  const bits = [];
  if (item.author) bits.push(item.author);
  bits.push(ageLabel(item));
  meta.textContent = bits.join(" · ");
  if (overdue) meta.title = "记下满 48 小时，工具栏数字也是这几条";
  if (item.url) {
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "打开";
    meta.append(" · ", link);
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  const primary = document.createElement("button");
  primary.type = "button";
  if (item.done) {
    primary.dataset.action = "undo";
    primary.textContent = "撤回";
  } else {
    primary.dataset.action = "done";
    primary.textContent = "完成";
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.dataset.action = "delete";
  remove.textContent = "删除";
  actions.append(primary, remove);

  row.append(text, meta, actions);
  parent.append(row);
}

function render(items) {
  latestItems = items;
  list.replaceChildren();
  doneList.replaceChildren();
  const open = items.filter((item) => !item.done).sort((a, b) => a.createdAt - b.createdAt);
  const done = items.filter((item) => item.done).sort((a, b) => (b.doneAt || b.createdAt) - (a.doneAt || a.createdAt));
  empty.hidden = open.length > 0;
  if (open.length > 0) {
    hint.hidden = true;
  } else if (done.length > 0) {
    hint.hidden = false;
    empty.textContent = "待办都完成了";
    hint.textContent = "做过的在下面。点错了，用「撤回」改回待办。";
  } else {
    hint.hidden = false;
    empty.textContent = "还没有待办";
    hint.textContent = "打开 X，在帖子下方点「记成待办」。改一句再回车，或直接回车保存原话。";
  }

  todoHintReady = open.length > 0;
  syncContextHint();

  open.forEach((item) => appendItem(list, item));
  doneToggle.hidden = done.length === 0;
  doneToggle.textContent = showDone ? `收起已完成 ${done.length}` : `已完成 ${done.length}`;
  doneList.hidden = !showDone || done.length === 0;
  if (!doneList.hidden) done.forEach((item) => appendItem(doneList, item));
}

function localStore() {
  if (!chrome.storage || !chrome.storage.local) return null;
  return chrome.storage.local;
}

function showStorageError() {
  empty.hidden = false;
  empty.textContent = "还不能保存";
  hint.hidden = false;
  hint.textContent = "请打开扩展页面，在「X 待办」卡片上点刷新。版本变成 0.8.5 后，再点一次工具栏图标。";
}

async function readItems() {
  const store = localStore();
  if (!store) return null;
  const stored = await store.get("items");
  return Array.isArray(stored.items) ? stored.items : [];
}

async function writeItems(items) {
  const store = localStore();
  if (!store) {
    showStorageError();
    return;
  }
  await store.set({ items });
  render(items);
  refreshBadge();
}

doneToggle.addEventListener("click", () => {
  showDone = !showDone;
  render(latestItems);
});

async function onItemClick(event) {
  const button = event.target.closest("button");
  const row = button && button.closest("[data-id]");
  if (!button || !row) return;
  const id = row.dataset.id;
  const items = await readItems();
  if (!items) {
    showStorageError();
    return;
  }
  if (button.dataset.action === "done") {
    showDone = true;
    await writeItems(
      items.map((item) => (item.id === id ? { ...item, done: true, doneAt: Date.now() } : item))
    );
  } else if (button.dataset.action === "undo") {
    await writeItems(
      items.map((item) => (item.id === id ? { ...item, done: false, doneAt: 0 } : item))
    );
  } else if (button.dataset.action === "delete") {
    await writeItems(items.filter((item) => item.id !== id));
  }
}

list.addEventListener("click", onItemClick);
doneList.addEventListener("click", onItemClick);

readItems().then((items) => {
  if (!items) {
    showStorageError();
    return;
  }
  render(items);
  refreshBadge();
});

const todoPane = document.querySelector("#todos");
const followPane = document.querySelector("#follows");
const followForm = document.querySelector("#follow-form");
const followInput = document.querySelector("#follow-input");
const followError = document.querySelector("#follow-error");
const followEmpty = document.querySelector("#follow-empty");
const followHint = document.querySelector("#follow-hint");
const followList = document.querySelector("#follow-list");
const followSearch = document.querySelector("#follow-search");
const followTags = document.querySelector("#follow-tags");
const followAddToggle = document.querySelector("#follow-add-toggle");
const followAddCancel = document.querySelector("#follow-add-cancel");
const followOffer = document.querySelector("#follow-offer");
const MAX_TAGS = 3;
const TAG_COLORS = [
  ["#e7f1fb", "#0f4c81"],
  ["#e7f6ef", "#0f6b45"],
  ["#fdf2e7", "#9a4d12"],
  ["#f3e8ff", "#6b21a8"],
  ["#fde8ee", "#9f1239"],
  ["#eef2ff", "#3730a3"],
];

let followState = [];
let followQuery = "";
let activeTag = "";
let dragId = "";

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const name = tab.dataset.tab;
    document.querySelectorAll(".tab").forEach((item) => {
      item.classList.toggle("is-active", item === tab);
    });
    todoPane.hidden = name !== "todos";
    followPane.hidden = name !== "follows";
    syncContextHint();
  });
});

const contextHint = document.querySelector("#context-hint");
const followContextHint = document.querySelector("#follow-context-hint");
let todoHintReady = false;
let followHintReady = false;

function syncContextHint() {
  contextHint.hidden = todoPane.hidden || !todoHintReady;
  followContextHint.hidden = !followHintReady;
}

function showFollowError(message) {
  followError.hidden = !message;
  followError.textContent = message || "";
}

function normalizeTag(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 12 ? text.slice(0, 12) : text;
}

function sameTag(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function tagColor(tag) {
  let hash = 0;
  const text = String(tag || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return TAG_COLORS[hash % TAG_COLORS.length];
}

function paintTag(element, tag) {
  const [background, color] = tagColor(tag);
  element.style.setProperty("--tag-bg", background);
  element.style.setProperty("--tag-fg", color);
}

function followLabel(item) {
  const nickname = String(item.name || "").trim();
  if (!nickname) return `@${item.handle}`;
  return `${nickname}@${item.handle}`;
}

function itemTags(item) {
  return Array.isArray(item.tags) ? item.tags : [];
}

function collectTags(follows) {
  const tags = [];
  follows.forEach((item) => {
    itemTags(item).forEach((tag) => {
      if (!tags.some((entry) => sameTag(entry, tag))) tags.push(tag);
    });
  });
  return tags;
}

function looksLikeProfileUrl(value) {
  return /(x|twitter)\.com\//i.test(value);
}

function matchesQuery(item, query) {
  const raw = query.trim();
  if (!raw) return true;
  if (looksLikeProfileUrl(raw)) {
    const handle = XTodoFollows.parseHandle(raw);
    return Boolean(handle) && XTodoFollows.sameHandle(item.handle, handle);
  }
  const keyword = raw.replace(/^@+/, "").toLowerCase();
  if (!keyword) return true;
  return (
    item.handle.toLowerCase().includes(keyword) ||
    String(item.name || "").toLowerCase().includes(keyword)
  );
}

function matchesTag(item, tag) {
  if (!tag) return true;
  return itemTags(item).some((entry) => sameTag(entry, tag));
}

function renderTagBar(follows) {
  const tags = collectTags(follows);
  followTags.replaceChildren();
  followTags.hidden = tags.length === 0;
  tags.forEach((tag) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag-filter";
    button.dataset.tag = tag;
    button.textContent = tag;
    paintTag(button, tag);
    if (activeTag && sameTag(activeTag, tag)) button.classList.add("is-active");
    followTags.append(button);
  });
}

function renderFollows(follows) {
  followState = follows;
  if (activeTag && !collectTags(follows).some((tag) => sameTag(tag, activeTag))) {
    activeTag = "";
  }
  const filtering = Boolean(followQuery.trim() || activeTag);
  const visible = follows.filter((item) => matchesQuery(item, followQuery) && matchesTag(item, activeTag));
  renderTagBar(follows);
  followList.replaceChildren();

  const offerHandle = XTodoFollows.parseHandle(followQuery);
  const canOffer =
    Boolean(offerHandle) && !follows.some((item) => XTodoFollows.sameHandle(item.handle, offerHandle));
  followOffer.hidden = !(visible.length === 0 && canOffer);
  followOffer.textContent = canOffer ? `添加 @${offerHandle}` : "";
  followOffer.dataset.handle = canOffer ? offerHandle : "";

  if (follows.length === 0) {
    followEmpty.hidden = false;
    followEmpty.textContent = "还没有关注";
    followHint.hidden = false;
    followHint.textContent = "点右上角「添加」，或在博主主页点「加入关注」。";
  } else if (visible.length === 0) {
    followEmpty.hidden = false;
    followEmpty.textContent = "没有找到";
    followHint.hidden = false;
    followHint.textContent = canOffer
      ? "搜索没有这位。可以点下面的按钮直接加入。"
      : "换一个昵称、用户名或主页链接。";
  } else {
    followEmpty.hidden = true;
    followHint.hidden = true;
  }
  followHintReady = follows.length > 0 && visible.length > 0;
  syncContextHint();

  visible.forEach((item) => {
    const row = document.createElement("li");
    row.className = "follow-item";
    row.dataset.id = item.id;

    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "drag-handle";
    handle.textContent = "⋮⋮";
    handle.title = filtering ? "清空搜索和标签后可以拖动" : "拖动调整顺序";
    handle.disabled = filtering;
    if (!filtering) bindDrag(row, handle, item.id);

    const link = document.createElement("a");
    link.className = "follow-link";
    const label = followLabel(item);
    link.href = XTodoFollows.profileUrl(item.handle);
    link.textContent = label;
    link.title = label;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      chrome.tabs.create({ url: XTodoFollows.profileUrl(item.handle) });
    });

    const actions = document.createElement("div");
    actions.className = "actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.action = "remove";
    remove.textContent = "移除";
    actions.append(remove);

    row.append(handle, link, actions, renderItemTags(item));
    followList.append(row);
  });
}

function renderItemTags(item) {
  const box = document.createElement("div");
  box.className = "tags";
  itemTags(item).forEach((tag) => {
    const wrap = document.createElement("span");
    wrap.className = "tag-wrap";
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "tag";
    pill.dataset.action = "filter-tag";
    pill.dataset.tag = tag;
    pill.textContent = tag;
    if (activeTag && sameTag(activeTag, tag)) pill.classList.add("is-active");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tag-remove";
    remove.dataset.action = "remove-tag";
    remove.dataset.tag = tag;
    remove.setAttribute("aria-label", `移除标签${tag}`);
    remove.textContent = "×";
    paintTag(wrap, tag);
    wrap.append(pill, remove);
    box.append(wrap);
  });
  if (itemTags(item).length < MAX_TAGS) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "tag-add";
    add.dataset.action = "add-tag";
    add.textContent = "加标签";
    add.title = "每人最多 3 个标签";
    box.append(add);
  }
  return box;
}

function bindDrag(row, handle, id) {
  handle.addEventListener("mousedown", () => {
    row.draggable = true;
  });
  handle.addEventListener("mouseup", () => {
    if (!dragId) row.draggable = false;
  });
  row.addEventListener("dragstart", (event) => {
    dragId = id;
    row.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  });
  row.addEventListener("dragend", () => {
    dragId = "";
    row.draggable = false;
    row.classList.remove("is-dragging");
    followList.querySelectorAll(".is-dragover").forEach((item) => item.classList.remove("is-dragover"));
  });
  row.addEventListener("dragover", (event) => {
    if (!dragId || dragId === id) return;
    event.preventDefault();
    row.classList.add("is-dragover");
  });
  row.addEventListener("dragleave", () => row.classList.remove("is-dragover"));
  row.addEventListener("drop", async (event) => {
    event.preventDefault();
    row.classList.remove("is-dragover");
    const sourceId = event.dataTransfer.getData("text/plain") || dragId;
    if (!sourceId || sourceId === id) return;
    const follows = await XTodoFollows.loadFollows();
    if (!follows) {
      showStorageError();
      return;
    }
    const from = follows.findIndex((item) => item.id === sourceId);
    const to = follows.findIndex((item) => item.id === id);
    if (from < 0 || to < 0) return;
    const copy = follows.slice();
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    await saveFollows(copy);
  });
}

function openTagInput(row, button) {
  const input = document.createElement("input");
  input.className = "tag-input";
  input.type = "text";
  input.maxLength = 12;
  input.placeholder = "标签";
  input.setAttribute("aria-label", "标签");
  button.replaceWith(input);
  input.focus();

  let settled = false;
  const finish = async (shouldSave) => {
    if (settled) return;
    settled = true;
    const tag = shouldSave ? normalizeTag(input.value) : "";
    if (!tag) {
      renderFollows(followState);
      return;
    }
    const follows = await XTodoFollows.loadFollows();
    if (!follows) {
      showStorageError();
      return;
    }
    const next = follows.map((item) => {
      if (item.id !== row.dataset.id) return item;
      const tags = itemTags(item).slice();
      if (tags.some((entry) => sameTag(entry, tag))) return item;
      if (tags.length >= MAX_TAGS) return item;
      tags.push(tag);
      return { ...item, tags };
    });
    showFollowError("");
    await saveFollows(next);
  };

  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(Boolean(input.value.trim())));
}

async function saveFollows(follows) {
  await XTodoFollows.storeFollows(follows);
  renderFollows(follows);
}

function closeAddForm() {
  followForm.hidden = true;
  followInput.value = "";
}

async function addFollowHandle(raw) {
  const handle = XTodoFollows.parseHandle(raw);
  if (!handle) {
    showFollowError("请输入用户名或主页链接，例如 @someone");
    return;
  }
  const follows = await XTodoFollows.loadFollows();
  if (!follows) {
    showStorageError();
    return;
  }
  if (follows.some((item) => XTodoFollows.sameHandle(item.handle, handle))) {
    showFollowError("这位博主已经在列表里");
    return;
  }
  showFollowError("");
  follows.push({
    id: crypto.randomUUID(),
    handle,
    name: "",
    tags: [],
    addedAt: Date.now(),
  });
  followQuery = "";
  followSearch.value = "";
  closeAddForm();
  await saveFollows(follows);
}

followAddToggle.addEventListener("click", () => {
  followForm.hidden = false;
  const parsed = XTodoFollows.parseHandle(followSearch.value);
  if (parsed) followInput.value = `@${parsed}`;
  followInput.focus();
  followInput.select();
});

followAddCancel.addEventListener("click", () => {
  showFollowError("");
  closeAddForm();
});

followForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await addFollowHandle(followInput.value);
});

followOffer.addEventListener("click", async () => {
  if (!followOffer.dataset.handle) return;
  await addFollowHandle(followOffer.dataset.handle);
});

followSearch.addEventListener("input", () => {
  followQuery = followSearch.value;
  renderFollows(followState);
});

followTags.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || !button.dataset.tag) return;
  activeTag = activeTag && sameTag(activeTag, button.dataset.tag) ? "" : button.dataset.tag;
  renderFollows(followState);
});

followList.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  const row = button && button.closest("[data-id]");
  if (!button || !row || !button.dataset.action) return;
  if (button.dataset.action === "add-tag") {
    const current = followState.find((item) => item.id === row.dataset.id);
    if (current && itemTags(current).length >= MAX_TAGS) {
      showFollowError("每人最多 3 个标签");
      return;
    }
    showFollowError("");
    openTagInput(row, button);
    return;
  }
  if (button.dataset.action === "filter-tag") {
    activeTag = activeTag && sameTag(activeTag, button.dataset.tag) ? "" : button.dataset.tag;
    renderFollows(followState);
    return;
  }
  const follows = await XTodoFollows.loadFollows();
  if (!follows) {
    showStorageError();
    return;
  }
  const id = row.dataset.id;
  if (button.dataset.action === "remove-tag") {
    await saveFollows(
      follows.map((item) => {
        if (item.id !== id) return item;
        return {
          ...item,
          tags: itemTags(item).filter((tag) => !sameTag(tag, button.dataset.tag)),
        };
      })
    );
  } else if (button.dataset.action === "remove") {
    await saveFollows(follows.filter((item) => item.id !== id));
  }
});

XTodoFollows.loadFollows().then((follows) => {
  if (!follows) return;
  renderFollows(follows);
});
