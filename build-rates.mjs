/* يسحب أسعار الصرف والذهب من الصفحة الرئيسية لموقع الليرة اليوم ويكتبها بـ rates.json
   الأرقام بالليرة الجديدة (القديمة = الجديدة × 100). تشغيل يدوي: node build-rates.mjs */
import fs from "node:fs";

const URL_ = "https://sp-today.com/";
const HEARTBEAT_MS = 3 * 3600 * 1000;
const CURS = [["USD", "دولار أمريكي"], ["EUR", "يورو"], ["TRY", "ليرة تركية"], ["SAR", "ريال سعودي"]];
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

export function parseRates(html) {
  const t = toText(html);
  const cur = {};
  for (const [code, name] of CURS) {
    const m = new RegExp(name + "\\s+" + NUM + "\\s+" + NUM).exec(t);
    if (!m) continue;
    const buy = num(m[1]), sell = num(m[2]);
    if (buy > 0 && sell >= buy * 0.9 && sell <= buy * 1.5) cur[code] = { buy, sell };
  }
  const gold = {};
  for (const k of ["24", "21", "18"]) {
    const m = new RegExp(k + "K\\s+\\$\\s?" + NUM + "\\s+" + NUM + "\\s+" + NUM).exec(t);
    if (!m) continue;
    const usd = num(m[1]), buy = num(m[2]), sell = num(m[3]);
    if (buy > 0 && sell >= buy * 0.9 && sell <= buy * 1.5) gold["k" + k] = { usd, buy, sell };
  }
  return { cur, gold };
}

async function main() {
  let html;
  try {
    const r = await fetch(URL_, { headers: { "user-agent": "Mozilla/5.0 (compatible; FamilyNewsApp/1.0)", "accept-language": "ar" }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    html = await r.text();
  } catch (e) { console.log("فشل جلب الصفحة: " + e.message); return; }

  const got = parseRates(html);
  if (!got.cur.USD) { console.log("ما لقيت سعر الدولار بالصفحة (يمكن تغيّر شكلها)، ما رح أكتب شي"); return; }
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
