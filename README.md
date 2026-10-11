# StreamSniffer Pro 🎬

> Modern ve Yüksek Başarımlı Medya Akışı Yakalayıcı, HLS/DASH Ayrıştırıcı ve İndirme Eklentisi (Chrome Manifest V3)

**StreamSniffer Pro**, web sayfalarında ve gömülü (iframe) oynatıcılarda çalışan video akışlarını (`.m3u8`, `.mpd`, `.mp4`, `.m4s`, `.webm`) çift katmanlı izleme mekanizmasıyla yakalayan, çok parçalı paralel indirme ve tarayıcı içi AES-128 deşifreleme yeteneklerine sahip açık kaynaklı bir tarayıcı eklentisidir.

---

## ✨ Temel Özellikler

### 1. Zırhlı Çift Katmanlı Ağ ve Bellek Dinleyicisi
* **MAIN Execution World Sızma:** Manifest V3'ün getirdiği izole dünyayı aşarak doğrudan ana sayfa bağlamında çalışır.
* **API Monkey-Patch:** `window.fetch`, `XMLHttpRequest` ve `HTMLMediaElement.prototype.play` çağrılarını bellek seviyesinde dinler. Blob URL'lerinin arkasına saklanan kaynakları orijinal manifest adreslerinden yakalar.
* **Derin Iframe Desteği:** `all_frames: true` ve `match_about_blank: true` yapılandırmasıyla 5 katmanlı gömülü reklam veya video iframe'leri dahil tüm çerçevelerdeki trafiği eksiksiz izler.
* **Background webRequest:** Arka planda servis işçisi seviyesinde ağ isteklerini filtreleyen ek güvenlik katmanı.

### 2. Akıllı HLS / Master M3U8 Ayrıştırıcı
* RFC 8216 standardına uygun tam ayrıştırma motoru.
* `#EXT-X-STREAM-INF` varyantlarını okuyarak tüm çözünürlükleri (`1080p`, `720p`, `480p`, `360p`) ve bant genişliklerini listeler.
* Görüntüden ayrı akan bağımsız ses kanallarını (`#EXT-X-MEDIA:TYPE=AUDIO`) tespit eder.
* `#EXT-X-KEY` ve `#EXT-X-SESSION-KEY` etiketlerindeki şifreleme yöntemlerini (AES-128) ve IV değerlerini ayrıştırır.

### 3. Çok Kanallı İndirme ve Bellekte Şifre Çözme (Offscreen Engine)
* **Offscreen Document Mimarisi:** Servis işçisinin 30 saniyelik uyku kısıtlamasına takılmadan kesintisiz indirme.
* **Paralel Segment İndirme:** Parçaları 5 eşzamanlı bağlantı ile hızlı şekilde çeker.
* **SubtleCrypto (AES-CBC) Desteği:** Şifreli segmentleri tarayıcının yerel Web Crypto API'sini kullanarak bellekte anında deşifre eder.
* **Otomatik Birleştirme:** İndirilen parçaları tek bir geçerli `.ts` medya dosyası olarak paketler ve `chrome.downloads` API'si üzerinden diske yazar.

### 4. Anti-Leech & 403 Forbidden Koruma Aşımı
* `declarativeNetRequest` kuralları ile indirme isteklerine orijinal sayfanın `Referer` ve `Origin` başlıklarını otomatik olarak enjekte eder.

---

## 📂 Proje Dizin Yapısı

```text
├── manifest.json            # Manifest V3 yetkilendirme ve kural tanımı
├── injected-interceptor.js  # MAIN world seviyesinde API monkey-patch ajanı
├── content-bridge.js        # MAIN world ile izole eklenti arası postMessage köprüsü
├── hls-parser.js            # RFC 8216 HLS Master & Media Playlist ayrıştırıcısı
├── background.js            # Service worker, ağ dinleyici, rozet ve anti-leech yöneticisi
├── offscreen.html           # Kesintisiz indirme ve kripto arka plan dokümanı
├── offscreen.js             # Çok kanallı segment fetcher & SubtleCrypto AES çözücü
├── popup.html               # Kullanıcı arayüzü
├── popup.css                # Modern koyu tema stil şablonu
├── popup.js                 # Kalite seçim ve indirme orkestrasyonu
└── README.md                # Dokümantasyon
```

---

## 🚀 Kurulum (Geliştirici Modu)

Eklentiyi Chromium tabanlı tüm tarayıcılarda (Google Chrome, Brave, Chromium, Vivaldi, Edge) çalıştırmak için:

1. Tarayıcınızın adres çubuğuna şunu yazın ve Enter'a basın:
   ```text
   chrome://extensions/
   ```
2. Sağ üst köşede yer alan **Geliştirici modu (Developer mode)** anahtarını etkinleştirin.
3. Sol üstteki **Paketlenmemiş öğe yükle (Load unpacked)** butonuna tıklayın.
4. Bu projenin bulunduğu klasörü seçin.
5. Eklenti simgesi araç çubuğunuza eklenecektir.

---

## 📖 Kullanım

1. Akış içeren herhangi bir web sitesine gidin.
2. Videoyu oynatın.
3. Eklenti rozetinde (badge) tespit edilen akış sayısını göreceksiniz.
4. Eklenti simgesine tıklayın:
   - İstediğiniz kaliteyi (1080p, 720p vb.) açılır menüden seçin.
   - **İndir** butonuna tıklayarak indirme işlemini başlatın.
   - İndirme hızı, kalan süre ve tamamlanan parça sayısı anlık olarak gösterilecektir.

---

## ⚖️ Lisans

Bu proje MIT lisansı ile lisanslanmıştır. Eğitim ve araştırma amaçlı geliştirilmiştir.
