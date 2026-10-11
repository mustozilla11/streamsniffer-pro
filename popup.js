// popup.js - StreamSniffer UI Controller
document.addEventListener('DOMContentLoaded', async () => {
  const mediaCountPill = document.getElementById('mediaCountPill');
  const mediaListContainer = document.getElementById('mediaListContainer');
  const downloadSection = document.getElementById('downloadProgressSection');
  const downloadFilename = document.getElementById('downloadFilename');
  const progressBarFill = document.getElementById('progressBarFill');
  const statPercent = document.getElementById('statPercent');
  const statSegments = document.getElementById('statSegments');
  const statSpeed = document.getElementById('statSpeed');
  const statEta = document.getElementById('statEta');
  const cancelBtn = document.getElementById('cancelDownloadBtn');

  // 1. Get current active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  // 2. Fetch detected media list from background
  chrome.runtime.sendMessage({ type: 'GET_TAB_MEDIA', tabId: tab.id }, async (response) => {
    const list = response?.mediaList || [];
    renderMediaList(list, tab);
  });

  // 3. Listen to download progress broadcasts
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'DOWNLOAD_PROGRESS') {
      const data = message.data;
      downloadSection.classList.remove('hidden');

      if (data.status === 'downloading') {
        progressBarFill.style.width = `${data.percent}%`;
        statPercent.textContent = `${data.percent}%`;
        statSegments.textContent = `${data.completedSegments} / ${data.totalSegments} parça (${data.downloadedMB} MB)`;
        statSpeed.textContent = `${data.speedMBs} MB/s`;
        statEta.textContent = `Kalan: ${formatTime(data.etaSeconds)}`;
      } else if (data.status === 'assembling') {
        progressBarFill.style.width = `99%`;
        statPercent.textContent = `99%`;
        statSegments.textContent = `Parçalar birleştiriliyor...`;
        statSpeed.textContent = `--`;
        statEta.textContent = `Tamamlanıyor`;
      } else if (data.status === 'completed') {
        progressBarFill.style.width = `100%`;
        statPercent.textContent = `100%`;
        statSegments.textContent = `İndirme tamamlandı!`;
        setTimeout(() => {
          downloadSection.classList.add('hidden');
        }, 4000);
      }
    }
  });

  cancelBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CANCEL_DOWNLOAD' });
    downloadSection.classList.add('hidden');
  });

  function renderMediaList(list, currentTab) {
    mediaCountPill.textContent = `${list.length} Medya`;

    if (list.length === 0) {
      mediaListContainer.innerHTML = `
        <div class="empty-state">
          <p>Bu sayfada henüz yakalanan medya yok.</p>
          <small>Video oynatıldığında sniffer otomatik olarak burada listeleyecektir.</small>
        </div>`;
      return;
    }

    mediaListContainer.innerHTML = '';

    list.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'media-card';

      const domain = safeGetHostname(item.url);
      const isM3U8 = item.url.includes('.m3u8');
      const typeLabel = isM3U8 ? 'HLS Stream' : (item.url.includes('.mpd') ? 'DASH' : 'MP4/WebM');

      card.innerHTML = `
        <div class="media-card-header">
          <span class="media-title" title="${item.url}">${truncateText(item.pageTitle || `Video #${index + 1} (${domain})`, 48)}</span>
          <span class="media-type-badge">${typeLabel}</span>
        </div>

        <div class="quality-control-row">
          <select class="quality-select" id="qualitySelect_${index}">
            <option value="${item.url}">Yükleniyor (Kaliteler taranıyor...)</option>
          </select>
          <button class="btn-download" id="downloadBtn_${index}">İndir</button>
          <button class="btn-copy" id="copyBtn_${index}">Kopyala</button>
        </div>
      `;

      mediaListContainer.appendChild(card);

      const qualitySelect = card.querySelector(`#qualitySelect_${index}`);
      const downloadBtn = card.querySelector(`#downloadBtn_${index}`);
      const copyBtn = card.querySelector(`#copyBtn_${index}`);

      // Copy link listener
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(qualitySelect.value || item.url);
        copyBtn.textContent = 'Kopyalandı!';
        setTimeout(() => copyBtn.textContent = 'Kopyala', 1500);
      });

      // Parse M3U8 Master variants if it's an m3u8 playlist
      if (isM3U8) {
        chrome.runtime.sendMessage({
          type: 'PARSE_PLAYLIST',
          url: item.url,
          referer: currentTab.url
        }, (res) => {
          if (res?.success && res.data?.variants?.length > 0) {
            qualitySelect.innerHTML = '';
            res.data.variants.forEach((v) => {
              const opt = document.createElement('option');
              opt.value = v.url;
              const bitrateStr = v.bandwidth ? ` (~${(v.bandwidth / 1000000).toFixed(1)} Mbps)` : '';
              opt.textContent = `${v.label}${bitrateStr}`;
              qualitySelect.appendChild(opt);
            });
          } else {
            qualitySelect.innerHTML = `<option value="${item.url}">Varsayılan Akış (Tekil Medya)</option>`;
          }
        });
      } else {
        qualitySelect.innerHTML = `<option value="${item.url}">Doğrudan Akış Linki</option>`;
      }

      // Download Action
      downloadBtn.addEventListener('click', async () => {
        const selectedUrl = qualitySelect.value || item.url;
        const pageOrigin = new URL(currentTab.url).origin;
        const targetHost = new URL(selectedUrl).hostname;

        // Anti-Leech spoofing
        await chrome.runtime.sendMessage({
          type: 'SETUP_ANTI_LEECH_RULES',
          targetOrigin: targetHost,
          spoofReferer: currentTab.url,
          spoofOrigin: pageOrigin
        });

        const videoTitle = (item.pageTitle || 'video').trim();
        downloadFilename.textContent = `${videoTitle} indiriliyor...`;
        downloadSection.classList.remove('hidden');

        chrome.runtime.sendMessage({
          type: 'START_DOWNLOAD_ORCHESTRATOR',
          payload: {
            variantUrl: selectedUrl,
            filename: videoTitle,
            referer: currentTab.url,
            concurrency: 5
          }
        }, (res) => {
          if (!res?.success) {
            alert('İndirme başlatılamadı: ' + (res?.error || 'Bilinmeyen hata'));
            downloadSection.classList.add('hidden');
          }
        });
      });
    });
  }

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds) || seconds <= 0) return '--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}dk ${secs}sn`;
  }

  function safeGetHostname(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return 'Bilinmeyen Kaynak';
    }
  }

  function truncateText(str, max) {
    return str.length > max ? str.slice(0, max) + '...' : str;
  }
});
