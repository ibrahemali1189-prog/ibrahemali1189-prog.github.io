/* يجيب آخر صورة (أو ألبوم صور) من قناة تلغرام العامة ويحفظها بالريبو، والتطبيق بيعرضها بكرت "أسعار اليوم".
   تشغيل يدوي: node build-photo.mjs   (يحتاج Node 18 أو أحدث، بدون مكتبات) */
import fs from "node:fs";

const CHANNEL = "syp2day";                 /* اسم القناة: t.me/syp2day */
const MAX_IMAGES = 4;
const GROUP_MS = 5 * 60 * 1000;            /* صور بفارق أقل من 5 دقايق من نفس الإصدار منعتبرها ألبوم واحد */
const MAX_BYTES = 4 * 1024 * 1024;
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const unent = (s) => s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return m; } }
  return ENT[e.toLowerCase()] ?? m;
});
const toText = (h) => unent(h.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim();

export function parseChannel(html) {
  const out = [];
  for (const part of html.split("tgme_widget_message_wrap").slice(1)) {
    const post = /data-post="([^"]+)"/.exec(part);
    if (!post) continue;
    const id = parseInt(post[1].split("/").pop(), 10);
    const imgs = [...part.matchAll(/tgme_widget_message_photo_wrap[^>]*background-image:\s*url\(['"]?([^'")]+)['"]?\)/g)].map((m) => unent(m[1]));
    const t = /<time[^>]*datetime="([^"]+)"/.exec(part);
    const tx = /tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/.exec(part);
    out.push({ id, imgs, date: t ? t[1] : "", text: tx ? toText(tx[1]) : "" });
  }
  return out;
}

/* آخر منشور فيه صور + الصور المجاورة له بالوقت (ألبوم) */
export function pickLatest(msgs) {
  const withImgs = msgs.filter((m) => m.imgs.length);
  if (!withImgs.length) return null;
  const last = withImgs[withImgs.length - 1];
  const t0 = Date.parse(last.date);
  const group = withImgs.filter((m) => m.id === last.id || (!isNaN(t0) && Math.abs(Date.parse(m.date) - t0) <= GROUP_MS));
  const images = group.flatMap((m) => m.imgs).slice(-MAX_IMAGES);
  const text = group.map((m) => m.text).find(Boolean) || "";
  return { id: last.id, date: last.date, text: text.slice(0, 300), images };
}

export async function main() {
  let html;
  try {
    const r = await fetch("https://t.me/s/" + CHANNEL, { headers: { "user-agent": UA, "accept-language": "ar,en;q=0.8" }, signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    html = await r.text();
  } catch (e) { console.log("فشل جلب صفحة القناة: " + e.message); return; }

  const msgs = parseChannel(html);
  console.log("منشورات بالصفحة: " + msgs.length);
  const pick = pickLatest(msgs);
  if (!pick) { console.log("ما لقيت منشور فيه صورة (يمكن القناة مقفلة المعاينة العامة)"); return; }

  let old = {};
  try { old = JSON.parse(fs.readFileSync("rates-photo.json", "utf8")); } catch {}
  const filesOk = old.images && old.images.length && old.images.every((f) => fs.existsSync(f));
  if (old.id === pick.id && filesOk) { console.log("نفس آخر صورة (#" + pick.id + ")، ما في جديد"); return; }

  const saved = [];
  for (let i = 0; i < pick.images.length; i++) {
    try {
      const r = await fetch(pick.images[i], { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 1000 || buf.length > MAX_BYTES) throw new Error("حجم غير منطقي: " + buf.length);
      const name = "rates-photo-" + (i + 1) + ".jpg";
      fs.writeFileSync(name, buf); saved.push(name);
    } catch (e) { console.log("فشل تنزيل صورة " + (i + 1) + ": " + e.message); }
  }
  if (!saved.length) { console.log("ما نزلت أي صورة، ما رح أحدّث الملف"); return; }
  fs.writeFileSync("rates-photo.json", JSON.stringify({ updated: new Date().toISOString(), channel: CHANNEL, id: pick.id, link: "https://t.me/" + CHANNEL + "/" + pick.id, date: pick.date, text: pick.text, images: saved }));
  console.log("تم حفظ " + saved.length + " صورة من المنشور #" + pick.id);
}
if (process.argv[1] && process.argv[1].endsWith("build-photo.mjs")) main();
