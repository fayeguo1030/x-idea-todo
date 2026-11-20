importScripts("badge.js");

function ensureAlarm() {
  chrome.alarms.create("refresh-badge", { periodInMinutes: 60 });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  refreshBadge();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  refreshBadge();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && Object.prototype.hasOwnProperty.call(changes, "items")) {
    refreshBadge();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refresh-badge") refreshBadge();
});
