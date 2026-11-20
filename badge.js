const OVERDUE_MS = 2 * 24 * 60 * 60 * 1000;

function overdueCount(items) {
  const now = Date.now();
  return items.filter((item) => {
    if (!item || item.done || !item.createdAt) return false;
    return now - item.createdAt >= OVERDUE_MS;
  }).length;
}

async function refreshBadge() {
  const stored = await chrome.storage.local.get("items");
  const items = Array.isArray(stored.items) ? stored.items : [];
  const count = overdueCount(items);
  await chrome.action.setBadgeText({ text: count > 0 ? String(Math.min(count, 99)) : "" });
  if (count > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: "#111827" });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: "#FFFFFF" });
    }
  }
}
