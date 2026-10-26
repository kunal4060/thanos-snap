/* Thanos Snap — background service worker.
   Chrome only auto-injects content scripts into tabs opened AFTER the
   extension is installed. This injects into meeting tabs that were already
   open when the user loaded the extension, so no manual reload is needed. */

const MEETING_URLS = [
  'https://meet.google.com/*',
  'https://teams.microsoft.com/*',
  'https://teams.live.com/*',
  'https://*.zoom.us/*',
];

chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: MEETING_URLS });
  for (const tab of tabs) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['styles.css'] });
    } catch (e) {
      // Tab may have navigated away or be a restricted page; ignore.
    }
  }
});
