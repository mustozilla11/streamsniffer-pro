// offscreen.js - Background Segment Fetcher, AES-128 Decryptor, and Stream Assembler
import { parseMediaPlaylist } from './hls-parser.js';

let isDownloading = false;
let shouldCancel = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_HLS_DOWNLOAD') {
    startDownload(message.payload)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'CANCEL_DOWNLOAD') {
    shouldCancel = true;
    sendResponse({ success: true });
    return true;
  }
});

async function startDownload({ variantUrl, filename, referer, concurrency = 4 }) {
  if (isDownloading) throw new Error('Zaten aktif bir indirme işlemi sürüyor.');
  isDownloading = true;
  shouldCancel = false;

  try {
    reportProgress({ status: 'fetching_manifest', percent: 0 });

    // 1. Variant M3U8 dosyasını çek ve parse et
    const resp = await fetch(variantUrl, {
      headers: referer ? { 'Referer': referer } : {}
    });
    if (!resp.ok) throw new Error(`Segment listesi alınamadı: HTTP ${resp.status}`);
    const manifestText = await resp.text();
    const parsed = parseMediaPlaylist(manifestText, variantUrl);

    if (!parsed.segments || parsed.segments.length === 0) {
      throw new Error('Manifestte indirilebilir segment bulunamadı.');
    }

    const segments = parsed.segments;
    const totalSegments = segments.length;
    const downloadedBuffers = new Array(totalSegments);
    const keyCache = new Map();

    // 2. Çok iş parçacıklı (Concurrent) İndirme & Deşifre Pipeline'ı
    let completedCount = 0;
    let downloadedBytes = 0;
    const startTime = Date.now();
    let lastTime = startTime;
    let lastBytes = 0;

    let segmentIndex = 0;

    async function worker() {
      while (segmentIndex < totalSegments) {
        if (shouldCancel) throw new Error('İndirme kullanıcı tarafından iptal edildi.');

        const currentIndex = segmentIndex++;
        const segment = segments[currentIndex];

        // Segmenti indir
        const segResp = await fetch(segment.url, {
          headers: referer ? { 'Referer': referer } : {}
        });
        if (!segResp.ok) throw new Error(`Segment #${currentIndex} indirilemedi: HTTP ${segResp.status}`);

        let arrayBuffer = await segResp.arrayBuffer();

        // 3. Şifreli ise (AES-128) deşifre et
        if (segment.key && segment.key.method === 'AES-128') {
          arrayBuffer = await decryptAES128Segment(
            arrayBuffer,
            segment.key.keyUri,
            segment.key.iv,
            keyCache,
            referer
          );
        }

        downloadedBuffers[currentIndex] = arrayBuffer;
        completedCount++;
        downloadedBytes += arrayBuffer.byteLength;

        // İlerleme, Hız ve ETA Hesaplama
        const now = Date.now();
        const timeDiffSec = (now - lastTime) / 1000;
        let speedMBs = 0;
        if (timeDiffSec >= 0.5) {
          const bytesDiff = downloadedBytes - lastBytes;
          speedMBs = (bytesDiff / (1024 * 1024 * timeDiffSec)).toFixed(2);
          lastTime = now;
          lastBytes = downloadedBytes;
        }

        const percent = Math.floor((completedCount / totalSegments) * 100);
        const elapsedTotalSec = (now - startTime) / 1000;
        const avgSpeedBytes = downloadedBytes / (elapsedTotalSec || 1);
        const remainingBytesEst = avgSpeedBytes * (totalSegments - completedCount) * (elapsedTotalSec / completedCount);
        const etaSeconds = Math.max(0, Math.floor(remainingBytesEst / (avgSpeedBytes || 1)));

        reportProgress({
          status: 'downloading',
          percent: percent,
          completedSegments: completedCount,
          totalSegments: totalSegments,
          downloadedMB: (downloadedBytes / (1024 * 1024)).toFixed(1),
          speedMBs: speedMBs || '0.00',
          etaSeconds: etaSeconds
        });
      }
    }

    // Eşzamanlı worker'ları başlat
    const workers = [];
    const activeConcurrency = Math.min(concurrency, totalSegments);
    for (let i = 0; i < activeConcurrency; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    // 4. Parçaları birleştirip Blob oluştur
    reportProgress({ status: 'assembling', percent: 99 });
    const finalBlob = new Blob(downloadedBuffers, { type: 'video/mp2t' });
    const blobUrl = URL.createObjectURL(finalBlob);

    // 5. Dosyayı indir
    const safeFilename = (filename || 'video').replace(/[/\\?%*:|"<>]/g, '_') + '.ts';
    chrome.downloads.download({
      url: blobUrl,
      filename: safeFilename,
      saveAs: false
    });

    reportProgress({ status: 'completed', percent: 100 });
  } finally {
    isDownloading = false;
  }
}

// AES-128-CBC Decryption via SubtleCrypto
async function decryptAES128Segment(encryptedBuffer, keyUri, ivHex, keyCache, referer) {
  let cryptoKey = keyCache.get(keyUri);

  if (!cryptoKey) {
    const keyResp = await fetch(keyUri, {
      headers: referer ? { 'Referer': referer } : {}
    });
    if (!keyResp.ok) throw new Error(`AES-128 anahtarı çekilemedi: HTTP ${keyResp.status}`);
    const keyRaw = await keyResp.arrayBuffer();

    cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyRaw,
      { name: 'AES-CBC' },
      false,
      ['decrypt']
    );
    keyCache.set(keyUri, cryptoKey);
  }

  // IV: 16 baytlık Uint8Array
  const ivBuffer = parseIV(ivHex);

  return await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: ivBuffer },
    cryptoKey,
    encryptedBuffer
  );
}

function parseIV(ivHex) {
  if (!ivHex) return new Uint8Array(16);
  const cleanHex = ivHex.startsWith('0x') ? ivHex.slice(2) : ivHex;
  const match = cleanHex.match(/.{1,2}/g) || [];
  const bytes = match.map((byte) => parseInt(byte, 16));
  const iv = new Uint8Array(16);
  iv.set(bytes.slice(0, 16));
  return iv;
}

function reportProgress(data) {
  chrome.runtime.sendMessage({
    type: 'DOWNLOAD_PROGRESS',
    data: data
  }).catch(() => {});
}
