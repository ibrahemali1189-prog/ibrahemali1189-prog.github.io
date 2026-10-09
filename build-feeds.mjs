/* يجلب كل المصادر المعرّفة بـ FEEDS داخل index.html ويكتبها بملف واحد feeds.json
   تشغيل يدوي: node scripts/build-feeds.mjs  (يحتاج Node 18 أو أحدث، بدون أي مكتبات) */
import fs from "node:fs";
import vm from "node:vm";

const MAX_PER_FEED = 25;
const HEARTBEAT_MS = 3 * 3600 * 1000;   /* نكتب الملف حتى لو ما تغيّر شي، كل 3 ساعات على الأقل */
const UA = "Mozilla/5.0 (compatible; FeedBot/1.0)";

/* ---- قراءة قائمة FEEDS من index.html (مصدر واحد للمعلومات) ---- */
function loadFeedList() {
  const html = fs.readFileSync("index.html", "utf8");
  const shorts = /const SHORTS = [^\n]*;/.exec(html);
  const gn = /const GN = [^\n]*;/.exec(html);
  const start = html.indexOf("const FEEDS = [");
  const end = html.indexOf("\n];", start);
  if (!shorts || !gn || start < 0 || end < 0) throw new Error("ما لقيت FEEDS داخل index.html");
  const code = shorts[0] + "\n" + gn[0] + "\n" + html.slice(start, end + 3) + "\nFEEDS;";
  return vm.runInNewContext(code, { encodeURIComponent });
}

/* ---- أدوات تحليل XML بسيطة (RSS و Atom) ---- */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const unent = (s) => s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return m; } }
  return ENT[e.toLowerCase()] ?? m;
});
const text = (s) => {
  if (s == null) return "";
  if (/<!\[CDATA\[/.test(s)) return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
  return unent(s).trim();
};
const tag = (b, name) => { const m = new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i").exec(b); return m ? m[1] : null; };
const attr = (b, name, a) => { const m = new RegExp("<" + name + "\\b[^>]*?\\b" + a + "=[\"']([^\"']+)[\"']", "i").exec(b); return m ? unent(m[1]) : ""; };
const firstImg = (h) => { const m = /<img[^>]+src=["']([^"']+)["']/i.exec(h || ""); return m ? unent(m[1]) : ""; };
const isImg = (url, type) => (type && /^image\//i.test(type)) || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url || "");

function parseFeed(xml, f) {
  const out = [];
  for (const m of xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const b = m[0];
    const title = text(tag(b, "title"));
    const link = attr(b, "link", "href") || text(tag(b, "link"));
    const pubRaw = text(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    const d = new Date(pubRaw);
    const pub = isNaN(d) ? pubRaw : d.toISOString();
    const descRaw = text(tag(b, "description") || tag(b, "summary") || tag(b, "media:description") || tag(b, "content"));
    const full = text(tag(b, "content:encoded"));
    let img = "";
    const enc = /<enclosure\b[^>]*>/i.exec(b);
    if (enc) { const u = attr(enc[0], "enclosure", "url"), t = attr(enc[0], "enclosure", "type"); if (isImg(u, t)) img = u; }
    if (!img) img = attr(b, "media:thumbnail", "url");
    if (!img) { const mc = /<media:content\b[^>]*>/i.exec(b); if (mc) { const u = attr(mc[0], "media:content", "url"); if (isImg(u, attr(mc[0], "media:content", "type")) || /image/i.test(attr(mc[0], "media:content", "medium"))) img = u; } }
    if (!img) img = firstImg(descRaw) || firstImg(full);
    if (!title && !descRaw) continue;
    out.push({ title, desc: f.gn ? "" : descRaw.slice(0, f.fb ? 4000 : 500), link, pub, img });
  }
  return out.sort((a, b) => new Date(b.pub) - new Date(a.pub)).slice(0, MAX_PER_FEED);
}

async function getFeed(f) {
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(f.url, { headers: { "user-agent": UA, accept: "application/rss+xml, application/xml, text/xml, */*" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const items = parseFeed(await r.text(), f);
      if (!items.length) throw new Error("no items");
      return items;
    } catch (e) { last = e; }
  }
  throw last;
}

async function main() {
  const feeds = loadFeedList();
  const urls = [...new Map(feeds.map((f) => [f.url, f])).values()];
  let old = { feeds: {} };
  try { old = JSON.parse(fs.readFileSync("feeds.json", "utf8")); } catch {}
  const result = {};
  let ok = 0, failed = [];
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < urls.length) {
      const f = urls[next++];
      try { result[f.url] = await getFeed(f); ok++; }
      catch (e) { failed.push(f.url.slice(0, 80) + " (" + e.message + ")"); result[f.url] = (old.feeds && old.feeds[f.url]) || []; }   /* إذا فشل مصدر نحتفظ بآخر نسخة سليمة */
    }
  }));
  console.log("نجح " + ok + " من " + urls.length);
  failed.forEach((x) => console.log("فشل: " + x));
  if (!ok) { console.log("ما نجح أي مصدر، ما رح نكتب الملف"); process.exit(0); }

  const sameFeeds = JSON.stringify(old.feeds) === JSON.stringify(result);
  const fresh = old.updated && Date.now() - Date.parse(old.updated) < HEARTBEAT_MS;
  if (sameFeeds && fresh) { console.log("ما في جديد"); return; }
  fs.writeFileSync("feeds.json", JSON.stringify({ updated: new Date().toISOString(), feeds: result }));
  console.log("تم تحديث feeds.json");
}
if (process.argv[1] && process.argv[1].endsWith("build-feeds.mjs")) main();
export { loadFeedList, parseFeed };
