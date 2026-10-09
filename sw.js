const C = "fb-news-v18";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  /* allSettled: إذا ملف ناقص (أيقونة مثلاً) ما بيفشل التثبيت كلو */
  e.waitUntil(caches.open(C).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ملفات التطبيق: من الشبكة أولاً، وإذا ما في إنترنت من الذاكرة.
   بنخزّن باسم الملف بدون ?t=... عشان الكاش ما يكبر وعشان الأوفلاين يلاقي الملف */
self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;
  const key = u.origin + u.pathname;
  e.respondWith(
    fetch(r)
      .then((res) => {
        if (res.ok) { const cp = res.clone(); caches.open(C).then((c) => c.put(key, cp)); }
        return res;
      })
      .catch(() => caches.match(key).then((m) => m || (r.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});
