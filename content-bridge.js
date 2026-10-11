// content-bridge.js (ISOLATED WORLD)
// Bridges events from MAIN world injected-interceptor.js to Background Service Worker

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== '__STREAM_SNIFFER_INTERCEPTOR__') {
    return;
  }

  const payload = event.data.payload;
  if (!payload || !payload.url) return;

  chrome.runtime.sendMessage({
    type: 'MEDIA_DETECTED',
    data: payload
  }).catch(() => {
    // Background worker might be waking up
  });
});
