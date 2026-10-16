// v2: キャッシュ優先をやめ、すべてネットワーク優先に変更。
// 名前を変えることで、activate 時に v1 を含む既存キャッシュがすべて削除される
const CACHE_NAME = "html-publisher-v2";

// インストール時にキャッシュするアセット
const STATIC_ASSETS = ["/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // APIリクエストはネットワーク優先
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: "Offline" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      })
    );
    return;
  }

  // ツールページはネットワーク優先、失敗時はキャッシュ
  if (
    url.pathname.startsWith("/tool/") ||
    url.pathname.startsWith("/tool-trust/")
  ) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // 成功したらキャッシュに保存
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => matchOwnCache(event.request))
    );
    return;
  }

  // その他もネットワーク優先にし、キャッシュはオフライン時の代替にだけ使う。
  // キャッシュ優先にすると、同一オリジンで動く trust モードのページが Cache API を
  // 書き換えた場合に、その内容が通常のページとして配信されてしまうため
  event.respondWith(fetch(event.request).catch(() => matchOwnCache(event.request)));
});

// caches.match() はオリジン内の全キャッシュを検索するため、この Service Worker が管理するキャッシュに限定する
function matchOwnCache(request) {
  return caches.open(CACHE_NAME).then((cache) => cache.match(request));
}
