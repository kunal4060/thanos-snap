/* Thanos Snap v2 — popup logic */
const MEETING_URLS = [
  'https://meet.google.com/*',
  'https://teams.microsoft.com/*',
  'https://teams.live.com/*',
  'https://*.zoom.us/*',
];

const enabledEl = document.getElementById('enabled');
const sensEl = document.getElementById('sensitivity');
const statusEl = document.getElementById('status');
const testBtn = document.getElementById('test');

chrome.storage.sync.get({ enabled: true, sensitivity: 'medium' }, (s) => {
  enabledEl.checked = s.enabled;
  sensEl.value = s.sensitivity;
});

enabledEl.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: enabledEl.checked });
  refreshStatus();
});

sensEl.addEventListener('change', () => {
  chrome.storage.sync.set({ sensitivity: sensEl.value });
});

testBtn.addEventListener('click', () => {
  chrome.tabs.query({ url: MEETING_URLS }, (tabs) => {
    if (!tabs.length) {
      statusEl.innerHTML = '<span class="dot off"></span>No Meet, Teams or Zoom tab open. Join a meeting first.';
      return;
    }
    chrome.tabs.sendMessage(tabs[0].id, { type: 'test-snap' }, () => {
      if (chrome.runtime.lastError) {
        statusEl.innerHTML = '<span class="dot off"></span>Extension is not running in that tab — reload the meeting page once, then try again.';
      } else {
        setTimeout(refreshStatus, 400);
      }
    });
  });
});

function sendToMeeting(msg) {
  chrome.tabs.query({ url: MEETING_URLS }, (tabs) => {
    if (tabs.length) chrome.tabs.sendMessage(tabs[0].id, msg, () => {});
  });
}

function refreshStatus() {
  chrome.tabs.query({ url: MEETING_URLS }, (tabs) => {
    if (!tabs.length) {
      statusEl.innerHTML = '<span class="dot off"></span>No Meet, Teams or Zoom tab open. Join a meeting first.';
      return;
    }
    chrome.tabs.sendMessage(tabs[0].id, { type: 'status' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        statusEl.innerHTML = '<span class="dot off"></span>Meeting tab found — reload the page once after installing.';
        return;
      }
      const on = res.enabled && res.listening;
      const dot = on ? '<span class="dot on"></span>' : '<span class="dot off"></span>';
      const site = res.site || 'this call';
      let line = on ? 'Listening for snaps on ' + site + '.' : 'Snap detection is off.';
      if (res.micDenied) line = 'Mic blocked — allow mic for this site, or use Alt+S.';
      if (res.invisible) line += '<br>You are currently invisible.';
      statusEl.innerHTML = dot + line;
    });
  });
}

refreshStatus();
