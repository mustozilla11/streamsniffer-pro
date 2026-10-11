// injected-interceptor.js (Runs in MAIN world to patch window APIs directly)
(() => {
  if (window.__STREAM_SNIFFER_INSTALLED__) return;
  window.__STREAM_SNIFFER_INSTALLED__ = true;

  const MEDIA_REGEX = /\.(m3u8|mpd|mp4|m4s|webm)($|\?|#)|(application\/(x-mpegURL|vnd\.apple\.mpegurl|dash\+xml))/i;

  function notifyMediaFound(url, type, headers = {}) {
    if (!url || typeof url !== 'string') return;
    
    let absoluteUrl = url;
    try {
      absoluteUrl = new URL(url, window.location.href).href;
    } catch (_) {}

    window.postMessage({
      source: '__STREAM_SNIFFER_INTERCEPTOR__',
      payload: {
        url: absoluteUrl,
        pageUrl: window.location.href,
        pageTitle: document.title || window.location.hostname,
        detectedType: type,
        headers: headers,
        referrer: document.referrer || window.location.origin,
        timestamp: Date.now()
      }
    }, '*');
  }

  // --- 1. Fetch Monkey-Patch ---
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    try {
      const input = args[0];
      const init = args[1] || {};
      const targetUrl = (typeof input === 'string') ? input : (input?.url || '');

      if (MEDIA_REGEX.test(targetUrl)) {
        notifyMediaFound(targetUrl, 'fetch', init.headers || {});
      }
    } catch (err) {
      console.warn('[StreamSniffer] Fetch hook error:', err);
    }
    return originalFetch.apply(this, args);
  };

  // --- 2. XMLHttpRequest Monkey-Patch ---
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__targetUrl = url;
    this.__requestHeaders = {};
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
    if (!this.__requestHeaders) this.__requestHeaders = {};
    this.__requestHeaders[header] = value;
    return originalSetRequestHeader.call(this, header, value);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (this.__targetUrl && MEDIA_REGEX.test(this.__targetUrl)) {
      notifyMediaFound(this.__targetUrl, 'xhr', this.__requestHeaders || {});
    }
    return originalSend.apply(this, args);
  };

  // --- 3. HTMLMediaElement.prototype.play & src Hook ---
  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    const src = this.currentSrc || this.src;
    if (src && !src.startsWith('blob:')) {
      if (MEDIA_REGEX.test(src)) {
        notifyMediaFound(src, 'media_element');
      }
    }
    return originalPlay.apply(this, args);
  };

  // --- 4. DOM MutationObserver for dynamically injected <video> / <source> ---
  const domObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        
        if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
          if (node.src && !node.src.startsWith('blob:')) {
            notifyMediaFound(node.src, 'dom_media');
          }
        } else if (node.tagName === 'SOURCE') {
          if (node.src && !node.src.startsWith('blob:')) {
            notifyMediaFound(node.src, 'dom_source');
          }
        }
      }
    }
  });

  domObserver.observe(document.documentElement || document, {
    childList: true,
    subtree: true
  });
})();
