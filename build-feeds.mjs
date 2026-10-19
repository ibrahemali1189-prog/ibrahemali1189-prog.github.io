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
    if (!title && !descRaw && !img) continue;   /* منشور صورة بدون نص منحتفظ فيه */
    out.push({ title, desc: f.gn ? "" : descRaw.slice(0, f.fb ? 4000 : 500), link, pub, img });
  }
  return out.sort((a, b) => new Date(b.pub) - new Date(a.pub)).slice(0, MAX_PER_FEED);
}

/* قنوات تلغرام العامة: صفحة المعاينة t.me/s/اسم_القناة (بدون تسجيل دخول) */
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
const tgText = (h) => unent(h.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim();
export function parseTelegram(html, channel, limit = MAX_PER_FEED) {
  const out = [];
  for (const part of html.split("tgme_widget_message_wrap").slice(1)) {
    const post = /data-post="([^"]+)"/.exec(part);
    if (!post) continue;
    const id = post[1].split("/").pop();
    const tx = /tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/.exec(part);
    const text = tx ? tgText(tx[1]) : "";
    const im = /tgme_widget_message_photo_wrap[^>]*background-image:\s*url\(['"]?([^'")]+)['"]?\)/.exec(part);
    const t = /<time[^>]*datetime="([^"]+)"/.exec(part);
    if (text.length < 4 && !im) continue;                /* منشور بدون نص وبدون صورة بس منتخطاه، وبدون نص وفيه صورة منحتفظ فيه */
    out.push({ title: text.split("\n")[0].slice(0, 120), desc: esc(text.slice(0, 1500)), link: "https://t.me/" + channel + "/" + id, pub: t ? t[1] : "", img: im ? unent(im[1]) : "" });
  }
  return out.sort((a, b) => new Date(b.pub) - new Date(a.pub)).slice(0, limit);
}

/* قناة تلغرام: صفحة المعاينة بتعرض حوالي 20 منشور بس، فبنرجع لورا بصفحات أقدم (?before=) إذا طلبت f.pages */
export async function moreTelegram(f, firstHtml) {
  const ch = (/t\.me\/s\/(\w+)/.exec(f.url) || [])[1] || "";
  const pages = Math.max(1, Math.min(f.pages || 1, 5)), limit = f.limit || MAX_PER_FEED;
  let html = firstHtml, all = parseTelegram(firstHtml, ch, 1000);
  for (let p = 1; p < pages; p++) {
    const ids = [...html.matchAll(/data-post="[^"]+\/(\d+)"/g)].map((m) => +m[1]);
    const min = ids.length ? Math.min(...ids) : 0;
    if (min <= 1) break;
    try {
      const r = await fetch(f.url + "?before=" + min, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) break;
      html = await r.text();
    } catch { break; }
    all = all.concat(parseTelegram(html, ch, 1000));
  }
  const seen = new Set();
  return all.filter((x) => !seen.has(x.link) && seen.add(x.link)).sort((a, b) => new Date(b.pub) - new Date(a.pub)).slice(0, limit);
}

async function getFeed(f) {
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(f.url, { headers: { "user-agent": UA, accept: "application/rss+xml, application/xml, text/xml, */*" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const body = await r.text();
      const items = f.tg ? await moreTelegram(f, body) : parseFeed(body, f);
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
