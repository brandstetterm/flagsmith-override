import { activeOverrideCount, loadConfig, originOf } from './lib/store.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

async function updateBadge(tab) {
  const origin = originOf(tab.url ?? '');
  const count = origin ? activeOverrideCount(await loadConfig(origin)) : 0;
  await chrome.action.setBadgeText({ tabId: tab.id, text: count ? String(count) : '' });
  await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#1971c2' });
}

async function updateAllBadges() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(updateBadge));
}

chrome.runtime.onInstalled.addListener(updateAllBadges);
chrome.runtime.onStartup.addListener(updateAllBadges);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'loading') updateBadge(tab);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some((key) => key.startsWith('fso:config:'))) {
    updateAllBadges();
  }
});
