// background.js - Service Worker (Dual-Sniffer + DNR Header Spoofing + State Management)
import { parseMasterPlaylist } from './hls-parser.js';

// Tab media state storage: tabId -> Map<url, MediaRecord>
const tabMediaMap = new Map();

const MEDIA_URL_REGEX = /\.(m3u8|mpd|mp4|m4s|webm)($|\?|#)|(application\/(x-mpegURL|vnd\.apple\.mpegurl|dash\+xml))/i;

// --- Layer 1: webRequest Sniffer ---
if (chrome.webRequest?.onBeforeRequest) {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.tabId < 0) return;
      if (MEDIA_URL_REGEX.test(details.url)) {
        registerMediaItem(details.tabId, {
          url: details.url,
          pageUrl: details.initiator || '',
          pageTitle: '',
          detectedType: 'network_layer',
          timestamp: Date.now()
        });
      }
    },
    { urls: ['<all_urls>'] }
  );
}

// --- Layer 2: Messages from content-bridge.js ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : message.tabId;

  if (message.type === 'MEDIA_DETECTED') {
    registerMediaItem(tabId, message.data);
    sendResponse({ status: 'ok' });
    return true;
  }

  if (message.type === 'GET_TAB_MEDIA') {
    const list = getMediaListForTab(message.tabId);
    sendResponse({ mediaList: list });
    return true;
  }

  if (message.type === 'PARSE_PLAYLIST') {
    handleParsePlaylist(message.url, message.referer)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'START_DOWNLOAD_ORCHESTRATOR') {
    ensureOffscreenDocument()
      .then(() => {
        return chrome.runtime.sendMessage({
          type: 'START_HLS_DOWNLOAD',
          payload: message.payload
        });
      })
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'SETUP_ANTI_LEECH_RULES') {
    setupAntiLeechRules(message.targetOrigin, message.spoofReferer, message.spoofOrigin)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument?.()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: 'HLS segment downloading and AES-128 decryption'
  });
}



// Clean up tab data on close
chrome.tabs.onRemoved.addListener((tabId) => {
  tabMediaMap.delete(tabId);
});

// Update badge when user switches tabs
chrome.tabs.onActivated.addListener(({ tabId }) => {
  updateBadge(tabId);
});

function registerMediaItem(tabId, item) {
  if (!tabId || tabId < 0 || !item?.url) return;

  if (!tabMediaMap.has(tabId)) {
    tabMediaMap.set(tabId, new Map());
  }

  const map = tabMediaMap.get(tabId);
  if (!map.has(item.url)) {
    map.set(item.url, {
      id: crypto.randomUUID(),
      url: item.url,
      pageUrl: item.pageUrl || '',
      pageTitle: item.pageTitle || 'Video Stream',
      detectedType: item.detectedType || 'unknown',
      timestamp: item.timestamp || Date.now(),
      parsedInfo: null
    });
    updateBadge(tabId);
  }
}

function getMediaListForTab(tabId) {
  if (!tabId || !tabMediaMap.has(tabId)) return [];
  return Array.from(tabMediaMap.get(tabId).values());
}

function updateBadge(tabId) {
  const count = tabMediaMap.has(tabId) ? tabMediaMap.get(tabId).size : 0;
  chrome.action.setBadgeText({
    tabId: tabId,
    text: count > 0 ? count.toString() : ''
  });
  chrome.action.setBadgeBackgroundColor({
    tabId: tabId,
    color: '#00C853' // Active green badge
  });
}

// Fetches manifest and parses variants
async function handleParsePlaylist(url, referer) {
  const headers = {};
  if (referer) {
    headers['Referer'] = referer;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Playlist isteği başarısız: HTTP ${response.status}`);
  }
  const text = await response.text();
  return parseMasterPlaylist(text, url);
}

// Anti-Leech: Sets declarativeNetRequest session rule to inject Referer & Origin
async function setupAntiLeechRules(targetDomain, spoofReferer, spoofOrigin) {
  if (!chrome.declarativeNetRequest) return;

  const ruleId = 9999;
  const modifyHeaders = [];

  if (spoofReferer) {
    modifyHeaders.push({
      header: 'Referer',
      operation: 'set',
      value: spoofReferer
    });
  }

  if (spoofOrigin) {
    modifyHeaders.push({
      header: 'Origin',
      operation: 'set',
      value: spoofOrigin
    });
  }

  if (modifyHeaders.length === 0) return;

  const rule = {
    id: ruleId,
    priority: 100,
    action: {
      type: 'modifyHeaders',
      requestHeaders: modifyHeaders
    },
    condition: {
      urlFilter: `*://${targetDomain}/*`,
      resourceTypes: ['xmlhttprequest', 'media', 'other']
    }
  };

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleId],
    addRules: [rule]
  });
}
