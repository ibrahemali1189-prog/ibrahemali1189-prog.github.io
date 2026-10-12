/* يسحب أسعار الصرف والذهب من الصفحة الرئيسية لموقع الليرة اليوم ويكتبها بـ rates.json
   الأرقام بالليرة الجديدة (القديمة = الجديدة × 100). تشغيل يدوي: node build-rates.mjs */
import fs from "node:fs";

const URL_ = "https://sp-today.com/";
const HEARTBEAT_MS = 3 * 3600 * 1000;
const CURS = [["USD", "دولار أمريكي"]];
const NUM = "([\\d,]+(?:\\.\\d+)?)";
const num = (s) => parseFloat(String(s).replace(/,/g, ""));

function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const GAP = "[^\\d]{0,15}";
const ok = (buy, sell) => buy > 0 && sell >= buy * 0.9 && sell <= buy * 1.5;

export function parseRates(html) {
  const t = toText(html);
  const cur = {};
  for (const [code, name] of CURS) {
    for (const m of t.matchAll(new RegExp(name + GAP + NUM + GAP + NUM, "g"))) {
      const buy = num(m[1]), sell = num(m[2]);
      if (ok(buy, sell)) { cur[code] = { buy, sell }; break; }
    }
  }
  const gold = {};
  for (const k of ["24", "21", "18"]) {
    for (const m of t.matchAll(new RegExp(k + "K" + GAP + NUM + GAP + NUM + GAP + NUM, "g"))) {
      const usd = num(m[1]), buy = num(m[2]), sell = num(m[3]);
      if (ok(buy, sell)) { gold["k" + k] = { usd, buy, sell }; break; }
    }
  }
  return { cur, gold };
}

const BROWSER = {
  "user-agent": "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "ar,en;q=0.8",
  "upgrade-insecure-requests": "1",
};
/* إذا الموقع رفض GitHub مباشرة، منجرّب عن طريق خدمات وسيطة بتجيب الصفحة من عندها */
const SOURCES = [
  ["مباشر", URL_, BROWSER],
  ["r.jina.ai", "https://r.jina.ai/" + URL_, {}],
  ["allorigins", "https://api.allorigins.win/raw?url=" + encodeURIComponent(URL_), {}],
];

async function main() {
  let got = null;
  for (const [name, url, headers] of SOURCES) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(25000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const g = parseRates(await r.text());
      if (!g.cur.USD) throw new Error("ما لقيت سعر الدولار بالصفحة");
      got = g; console.log("نجح الجلب عن طريق: " + name); break;
    } catch (e) { console.log("فشل (" + name + "): " + e.message); }
  }
  if (!got) { console.log("ما نجحت أي طريقة، ما رح أكتب شي"); return; }
  console.log("عملات: " + Object.keys(got.cur).join(",") + " | ذهب: " + Object.keys(got.gold).join(","));

  let old = {};
  try { old = JSON.parse(fs.readFileSync("rates.json", "utf8")); } catch {}
  const same = JSON.stringify(old.cur) === JSON.stringify(got.cur) && JSON.stringify(old.gold) === JSON.stringify(got.gold);
  const fresh = old.updated && Date.now() - Date.parse(old.updated) < HEARTBEAT_MS;
  if (same && fresh) { console.log("ما في تغيير"); return; }
  fs.writeFileSync("rates.json", JSON.stringify({ updated: new Date().toISOString(), source: "sp-today.com", unit: "new_syp", ...got }));
  console.log("تم تحديث rates.json");
}
if (process.argv[1] && process.argv[1].endsWith("build-rates.mjs")) main();
