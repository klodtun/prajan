#!/usr/bin/env node
/**
 * Prajan Local Server — ไม่ต้องใช้ MySQL
 *
 * อ่าน Knowledge Base จาก data/line-autoreply-messages.json
 * และ data/knowledge-base-enriched.csv
 * รันบน Desktop + ngrok tunnel → LINE webhook ใช้ได้ทันที
 *
 * วิธีใช้:
 *   node src/local-server.js
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Load Knowledge Base from JSON ───

const KB_PATH = resolve(__dirname, "..", "data", "line-autoreply-messages.json");
const CSV_PATH = resolve(__dirname, "..", "data", "knowledge-base-enriched.csv");

let kbMessages = {};
let kbEntries = [];

function loadKB() {
  try {
    kbMessages = JSON.parse(readFileSync(KB_PATH, "utf-8"));
    console.log(`  KB loaded: ${Object.keys(kbMessages).length} keyword responses`);
  } catch (err) {
    console.error("  WARNING: Could not load KB JSON:", err.message);
  }

  try {
    kbEntries = parseCSV(readFileSync(CSV_PATH, "utf-8"));
    console.log(`  CSV loaded: ${kbEntries.length} entries`);
  } catch (err) {
    console.error("  WARNING: Could not load CSV:", err.message);
  }
}

function parseCSV(text) {
  const lines = [];
  let current = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { current.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        current.push(field);
        if (current.length > 1) lines.push(current);
        current = []; field = "";
      } else { field += ch; }
    }
  }
  if (field || current.length) { current.push(field); if (current.length > 1) lines.push(current); }
  const headers = lines[0];
  return lines.slice(1).map((cols) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] || "").trim(); });
    return obj;
  });
}

// ─── LINE helpers ───

const LINE_API = "https://api.line.me/v2/bot";
const LINE_DATA_API = "https://api-data.line.me/v2/bot";
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const SECRET = process.env.LINE_CHANNEL_SECRET || "";

function verifySignature(rawBody, signature) {
  if (!SECRET || !signature) return false;
  const digest = crypto.createHmac("sha256", SECRET).update(rawBody).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function replyMessage(replyToken, messages) {
  if (!replyToken || !TOKEN) return;
  const res = await fetch(`${LINE_API}/message/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) console.error(`Reply failed: ${res.status} ${await res.text()}`);
}

function textMsg(text) {
  return { type: "text", text };
}

// ─── Whisper STT (optional) ───

async function transcribeAudio(messageId) {
  if (!process.env.OPENAI_API_KEY) return null;

  const contentRes = await fetch(`${LINE_DATA_API}/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!contentRes.ok) return null;

  const buffer = Buffer.from(await contentRes.arrayBuffer());
  const contentType = contentRes.headers.get("content-type") || "audio/m4a";
  const ext = contentType.includes("mpeg") ? "mp3" : "m4a";

  const form = new FormData();
  form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
  form.append("language", "th");
  form.append("prompt", "ถอดเสียงภาษาไทยหรืออังกฤษ รหัสเช่น AI01 sec05 pdpa10");
  form.append("file", new Blob([buffer], { type: contentType }), `voice.${ext}`);

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) return null;
  return (await res.json()).text || "";
}

// ─── Category definitions ───

const CATEGORIES = {
  pdpa: { label: "PDPA", desc: "ข้อมูลส่วนบุคคล" },
  sec: { label: "Security", desc: "ความปลอดภัย/Cybersecurity" },
  ai: { label: "AI", desc: "ปัญญาประดิษฐ์" },
  train: { label: "Training", desc: "อบรม/Workshop" },
  consent: { label: "Consent", desc: "Cookie/Privacy Notice" },
  dpo: { label: "DPO", desc: "เจ้าหน้าที่คุ้มครองข้อมูล" },
  svc: { label: "บริการ", desc: "Consulting/บริการ" },
};

const PAGE_SIZE = 10;

// ─── Pagination session per user ───
// { userId: { category: "sec", page: 0, timestamp: Date.now() } }
const browseSession = new Map();
const SESSION_TTL = 10 * 60 * 1000; // 10 นาที

function setBrowse(userId, category, page) {
  browseSession.set(userId, { category, page, timestamp: Date.now() });
}

function getBrowse(userId) {
  const s = browseSession.get(userId);
  if (!s) return null;
  if (Date.now() - s.timestamp > SESSION_TTL) {
    browseSession.delete(userId);
    return null;
  }
  return s;
}

function clearBrowse(userId) {
  browseSession.delete(userId);
}

// ─── Build one page of category items ───

function buildCategoryPage(userId, catKey, page) {
  const cat = CATEGORIES[catKey];
  const items = kbEntries.filter((e) => e["Category"] === catKey);
  if (items.length === 0) return [textMsg(`หมวด ${cat.label} ยังไม่มีข้อมูลครับ`)];

  const totalPages = Math.ceil(items.length / PAGE_SIZE);
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const pageItems = items.slice(start, start + PAGE_SIZE);

  // จำ session
  setBrowse(userId, catKey, safePage);

  // สร้างรายการ
  const lines = pageItems.map((e, i) => {
    const num = start + i + 1;
    const code = e["Keyword Code"];
    const title = (e["Video Title (ชื่อคลิป)"] || "").slice(0, 45);
    return `${num}. ${code}  ${title}`;
  });

  let msg = `📚 ${cat.label} (${cat.desc})\n`;
  msg += `หน้า ${safePage + 1}/${totalPages} (${items.length} รายการ)\n`;
  msg += `─────────────────\n`;
  msg += lines.join("\n");
  msg += `\n─────────────────\n`;

  if (safePage + 1 < totalPages) {
    const nextStart = (safePage + 1) * PAGE_SIZE + 1;
    const nextEnd = Math.min((safePage + 2) * PAGE_SIZE, items.length);
    msg += `พิมพ์ "ต่อ" → หน้าถัดไป (${nextStart}-${nextEnd})`;
  } else {
    msg += `✅ แสดงครบทุกรายการแล้ว`;
  }
  msg += `\nพิมพ์รหัส เช่น ${pageItems[0]["Keyword Code"]} เพื่อดูคลิป`;

  return [textMsg(msg)];
}

// ─── Handle user message ───

function handleText(text, userId) {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, "");

  // "ต่อ" / "เพิ่ม" / "ต่อไป" / "next" → ดูหน้าถัดไปของหมวดที่กำลังดูอยู่
  if (["ต่อ", "เพิ่ม", "ต่อไป", "next", "ถัดไป", "ข้อมูลเพิ่ม"].includes(normalized)) {
    const session = getBrowse(userId);
    if (session) {
      return buildCategoryPage(userId, session.category, session.page + 1);
    }
    return [textMsg("ยังไม่ได้เลือกหมวด พิมพ์ชื่อหมวดก่อนนะครับ เช่น pdpa, sec, ai")];
  }

  // Category name match FIRST (e.g. pdpa, sec, ai, Sec, PDPA)
  if (CATEGORIES[normalized]) {
    return buildCategoryPage(userId, normalized, 0);
  }

  // Clear browse session when switching to other commands
  clearBrowse(userId);

  // Exact keyword code match (e.g. sec01, pdpa05, SEC01, Pdpa05)
  if (kbMessages[normalized]) {
    return [kbMessages[normalized]];
  }

  // KB / knowledge / ดูคลิป
  if (["kb", "knowledge", "ดูคลิป", "คลิป", "content", "คลังความรู้"].includes(normalized)) {
    const catList = Object.entries(CATEGORIES).map(([k, v]) => `  ${k} → ${v.label} (${v.desc})`).join("\n");
    return [textMsg(`📚 คลังความรู้ Prajan\n\nพิมพ์ชื่อหมวดเพื่อดูรายการ:\n${catList}\n\nหรือพิมพ์รหัสตรง เช่น sec01, pdpa05, ai03`)];
  }

  // ขอพร / สุ่มพร
  if (["ขอพร", "สุ่มพร", "พรประจำวัน"].includes(normalized)) {
    const blessings = [
      "วันนี้ให้เริ่มจากสิ่งเล็กที่ชัดที่สุด แล้วคำตอบถัดไปจะสว่างขึ้นเอง",
      "พระจันทร์ขอให้คุณเจอทางลัดที่ไม่ลดคุณภาพ และมีแรงพอทำสิ่งสำคัญให้จบ",
      "คืนนี้เหมาะกับการตัดสิ่งรบกวน เหลือไว้แค่หนึ่งงานที่ควรเดินหน้า",
      "ปัญหาที่ดูใหญ่ตอนกลางคืนมักเล็กลงเมื่อเช้ามาถึง จดไว้แล้วพักก่อน",
      "ไม่มีใครชนะด้วยความรู้อย่างเดียว แต่ชนะด้วยการลงมือทำซ้ำจนชำนาญ",
    ];
    const blessing = blessings[Math.floor(Math.random() * blessings.length)];
    return [textMsg(`🌙 ${blessing}\n\n✨ แจ้งพร ความต้องการทางธุรกิจของท่านมาให้เรา ถ้าเราทำได้เราจะทำให้\n\nพิมพ์ 'kb' ดูคลังความรู้ หรือ 'ติดต่อ' เพื่อคุยกับทีมงาน`)];
  }

  // ติดต่อเจ้าหน้าที่
  if (normalized.includes("ติดต่อเจ้าหน้าที่") || normalized.includes("ติดต่อ")) {
    return [textMsg("ได้ครับ กรุณาฝากชื่อ-เบอร์ติดต่อไว้ แล้วทีมงาน Prajan จะติดต่อกลับให้ครับ")];
  }

  // สินค้า / บริการ
  if (normalized.includes("สินค้า") || normalized.includes("บริการ")) {
    const items = kbEntries.filter((e) => e["Category"] === "svc");
    if (items.length > 0) {
      const list = items.map((e) => `${e["Keyword Code"]} - ${e["Video Title (ชื่อคลิป)"].slice(0, 50)}`).join("\n");
      return [textMsg(`สินค้าและบริการ:\n\n${list}\n\nพิมพ์รหัส เช่น ${items[0]["Keyword Code"]} เพื่อดูรายละเอียด`)];
    }
  }

  // Fuzzy search: try matching title keywords
  const matches = kbEntries.filter((e) => {
    const title = (e["Video Title (ชื่อคลิป)"] || "").toLowerCase();
    const tags = (e["Keywords / Tag"] || "").toLowerCase();
    const words = normalized.split(/\s+/).filter((w) => w.length > 2);
    return words.some((w) => title.includes(w) || tags.includes(w));
  });

  if (matches.length > 0) {
    if (matches.length === 1) {
      const code = matches[0]["Keyword Code"];
      return kbMessages[code] ? [kbMessages[code]] : [textMsg(`พบ: ${matches[0]["Video Title (ชื่อคลิป)"]}\nพิมพ์ ${code} เพื่อดูรายละเอียด`)];
    }
    const list = matches.slice(0, 10).map((e) => `${e["Keyword Code"]} - ${e["Video Title (ชื่อคลิป)"].slice(0, 50)}`).join("\n");
    const more = matches.length > 10 ? `\n... อีก ${matches.length - 10} รายการ` : "";
    return [textMsg(`🔍 พบ ${matches.length} รายการที่เกี่ยวข้อง:\n\n${list}${more}\n\nพิมพ์รหัสเพื่อดูรายละเอียด`)];
  }

  // Fallback
  return [textMsg(
    "พระจันทร์ยังไม่พบข้อมูลนี้ครับ ลองพิมพ์:\n" +
    "  'kb' → ดูคลังความรู้ทั้งหมด\n" +
    "  'pdpa' → หมวด PDPA\n" +
    "  'sec' → หมวด Security\n" +
    "  'ai' → หมวด AI\n" +
    "  'ขอพร' → สุ่มพรประจำวัน\n" +
    "  หรือพิมพ์รหัสตรง เช่น sec01, pdpa05"
  )];
}

// ─── Fastify Server ───

const app = Fastify({ logger: true, bodyLimit: 30 * 1024 * 1024 });
await app.register(cors);
await app.register(formbody);

app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
  request.rawBody = body;
  try { done(null, JSON.parse(body.toString("utf8"))); }
  catch (error) { done(error); }
});

app.get("/", async () => ({
  ok: true,
  service: "prajan-line-oa (local)",
  kb_entries: kbEntries.length,
  kb_messages: Object.keys(kbMessages).length,
}));

app.get("/health", async () => ({ ok: true }));

app.post("/webhook", async (request, reply) => {
  const signature = request.headers["x-line-signature"];
  if (!verifySignature(request.rawBody, signature)) {
    request.log.warn("Invalid LINE signature");
    return reply.code(401).send({ ok: false });
  }

  for (const event of request.body.events || []) {
    try {
      if (event.type === "follow") {
        await replyMessage(event.replyToken, [
          textMsg("สวัสดี เรา prajan (พระจันทร์) แสงสว่างนำทางในค่ำคืนที่สับสน\n\nพิมพ์ 'kb' เพื่อดูคลังความรู้ หรือพิมพ์รหัส เช่น sec01, pdpa05 ได้เลย\nหรือจะลอง 'ขอพร' ก็ได้นะ")
        ]);
        continue;
      }

      if (event.type !== "message") continue;

      let userText = "";

      if (event.message?.type === "text") {
        userText = event.message.text || "";
      } else if (event.message?.type === "audio") {
        userText = await transcribeAudio(event.message.id) || "";
        if (!userText) {
          await replyMessage(event.replyToken, [textMsg("ระบบรับเสียงแล้ว แต่ยังแปลงไม่สำเร็จ ลองพิมพ์ข้อความแทนนะครับ")]);
          continue;
        }
      } else {
        await replyMessage(event.replyToken, [textMsg("ขออภัยครับ ตอนนี้รองรับข้อความตัวอักษรและเสียงเท่านั้น")]);
        continue;
      }

      const userId = event.source?.userId || "unknown";
      const messages = handleText(userText, userId);
      await replyMessage(event.replyToken, messages);

    } catch (err) {
      request.log.error(err);
      await replyMessage(event.replyToken, [textMsg("ขออภัยครับ พระจันทร์ประมวลผลไม่สำเร็จชั่วคราว ลองใหม่อีกครั้งนะ")]);
    }
  }

  return { ok: true };
});

// ─── Start ───

console.log("\n🌙 Prajan Local Server");
console.log("Loading Knowledge Base...");
loadKB();

const port = Number(process.env.PORT || 3000);
const host = "0.0.0.0";

try {
  await app.listen({ port, host });
  console.log(`\n✅ Server running at http://localhost:${port}`);
  console.log(`\nNext: run ngrok in another terminal:`);
  console.log(`  ngrok http ${port}`);
  console.log(`\nThen set Webhook URL in LINE Developers Console to:`);
  console.log(`  https://xxxx.ngrok-free.app/webhook`);
} catch (err) {
  console.error("Startup failed:", err);
  process.exit(1);
}
