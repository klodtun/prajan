import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import {
  buildContentFlex,
  fallbackMessage,
  getLineMessageContent,
  replyMessage,
  textMessage,
  transcribeAudio,
  verifyLineSignature,
  welcomeMessage
} from "./line.js";
import {
  autoUpgradeSegment,
  findContentByMessage,
  getLeadByUserId,
  getLeadSession,
  getMoonWisdom,
  handleLeadAnswer,
  listContentByCategory,
  listContentItems,
  listLeads,
  startLeadFlow,
  trackInteraction,
  updateLead,
  upsertContentItem
} from "./db.js";
import {
  createBroadcast,
  listBroadcasts,
  sendBroadcast,
  sendIndividualMessage
} from "./broadcast.js";
import {
  createRichMenu,
  deleteRichMenu,
  listRichMenus,
  setDefaultRichMenu,
  uploadRichMenuImage
} from "./richmenu.js";
import { privacyHtml, termsHtml } from "./pages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_PATH = (process.env.BASE_PATH || "/").replace(/\/+$/, "") || "/";

const app = Fastify({
  logger: true,
  bodyLimit: 30 * 1024 * 1024
});

await app.register(cors);
await app.register(formbody);

app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
  request.rawBody = body;
  try {
    done(null, JSON.parse(body.toString("utf8")));
  } catch (error) {
    done(error);
  }
});

app.get("/health", async () => ({ ok: true, service: "prajan-line-oa" }));

await app.register(async function prajanRoutes(instance) {

  instance.get("/", async () => ({
    ok: true,
    service: "prajan-line-oa",
    endpoints: { privacy: "/privacy", terms: "/terms", webhook: "/webhook", admin: "/admin" }
  }));

  instance.get("/privacy", async (request, reply) => {
    reply.type("text/html; charset=utf-8").send(privacyHtml(publicBaseUrl()));
  });

  instance.get("/terms", async (_request, reply) => {
    reply.type("text/html; charset=utf-8").send(termsHtml());
  });

  instance.get("/admin", async (_request, reply) => {
    const html = await readFile(path.join(__dirname, "..", "public", "admin.html"), "utf8");
    reply.type("text/html; charset=utf-8").send(html);
  });

  instance.post("/webhook", async (request, reply) => {
    const signature = request.headers["x-line-signature"];
    if (!verifyLineSignature(request.rawBody, signature)) {
      request.log.warn("Invalid LINE signature");
      return reply.code(401).send({ ok: false });
    }

    for (const event of request.body.events || []) {
      await handleLineEvent(event, request.log);
    }

    return { ok: true };
  });

  // --- Content CMS ---

  instance.get("/api/content", { preHandler: requireAdmin }, async () => listContentItems());

  instance.post("/api/content", { preHandler: requireAdmin }, async (request) => {
    const id = await upsertContentItem(request.body || {});
    return { ok: true, id };
  });

  instance.get("/api/links", async () => {
    const baseUrl = publicBaseUrl();
    return {
      privacy: `${baseUrl}/privacy`,
      terms: `${baseUrl}/terms`,
      webhook: `${baseUrl}/webhook`,
      admin: `${baseUrl}/admin`
    };
  });

  // --- Leads Management ---

  instance.get("/api/leads", { preHandler: requireAdmin }, async (request) => {
    return listLeads(request.query || {});
  });

  instance.post("/api/leads/:userId", { preHandler: requireAdmin }, async (request) => {
    await updateLead(request.params.userId, request.body || {});
    return { ok: true };
  });

  // --- Broadcast ---

  instance.get("/api/broadcasts", { preHandler: requireAdmin }, async () => listBroadcasts());

  instance.post("/api/broadcasts", { preHandler: requireAdmin }, async (request) => {
    const id = await createBroadcast(request.body || {});
    return { ok: true, id };
  });

  instance.post("/api/broadcasts/:id/send", { preHandler: requireAdmin }, async (request) => {
    const result = await sendBroadcast(Number(request.params.id));
    return { ok: true, ...result };
  });

  instance.post("/api/push", { preHandler: requireAdmin }, async (request) => {
    const { line_user_id, message } = request.body || {};
    if (!line_user_id || !message) {
      return { ok: false, error: "line_user_id and message required" };
    }
    await sendIndividualMessage(line_user_id, message);
    return { ok: true };
  });

  // --- Rich Menu ---

  instance.get("/api/richmenu", { preHandler: requireAdmin }, async () => {
    const menus = await listRichMenus();
    return { menus };
  });

  instance.post("/api/richmenu/create", { preHandler: requireAdmin }, async () => {
    const richMenuId = await createRichMenu();
    return { ok: true, richMenuId };
  });

  instance.post("/api/richmenu/:id/default", { preHandler: requireAdmin }, async (request) => {
    await setDefaultRichMenu(request.params.id);
    return { ok: true };
  });

  instance.delete("/api/richmenu/:id", { preHandler: requireAdmin }, async (request) => {
    await deleteRichMenu(request.params.id);
    return { ok: true };
  });

}, { prefix: BASE_PATH });

// --- Category definitions ---

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
const NEXT_KEYWORDS = ["ต่อ", "เพิ่ม", "ต่อไป", "next", "ถัดไป", "ข้อมูลเพิ่ม"];

// --- Pagination session per user (in-memory, auto-expire 10 min) ---

const browseSession = new Map();
const SESSION_TTL = 10 * 60 * 1000;

function setBrowse(userId, category, page) {
  browseSession.set(userId, { category, page, timestamp: Date.now() });
}

function getBrowse(userId) {
  const s = browseSession.get(userId);
  if (!s) return null;
  if (Date.now() - s.timestamp > SESSION_TTL) { browseSession.delete(userId); return null; }
  return s;
}

function clearBrowse(userId) {
  browseSession.delete(userId);
}

async function buildCategoryPage(userId, catKey, page) {
  const cat = CATEGORIES[catKey];
  const items = await listContentByCategory(catKey);
  if (items.length === 0) return [textMessage(`หมวด ${cat.label} ยังไม่มีข้อมูลในระบบครับ`)];

  const totalPages = Math.ceil(items.length / PAGE_SIZE);
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const pageItems = items.slice(start, start + PAGE_SIZE);

  setBrowse(userId, catKey, safePage);

  const lines = pageItems.map((item, i) => {
    const num = start + i + 1;
    const title = (item.title || "").slice(0, 45);
    return `${num}. ${item.code}  ${title}`;
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
  msg += `\nพิมพ์รหัส เช่น ${pageItems[0].code} เพื่อดูคลิป`;

  return [textMessage(msg)];
}

// --- Business logic ---

async function handleLineEvent(event, log) {
  if (event.type === "follow") {
    await replyMessage(event.replyToken, [welcomeMessage()]);
    return;
  }

  if (event.type !== "message") return;

  const userId = event.source?.userId || "unknown";
  const messageType = event.message?.type || "unknown";
  let userText = "";

  const lead = await getLeadByUserId(userId);
  if (lead?.status === "blocked") return;

  try {
    if (messageType === "text") {
      userText = event.message.text || "";
    } else if (messageType === "audio") {
      const audio = await getLineMessageContent(event.message.id);
      userText = await transcribeAudio(audio.buffer, audio.contentType);
      if (!userText) {
        await replyMessage(event.replyToken, [
          textMessage("ตอนนี้ระบบรับเสียงแล้ว แต่ยังไม่ได้ตั้งค่า OPENAI_API_KEY สำหรับถอดเสียงครับ")
        ]);
        return;
      }
    } else {
      await replyMessage(event.replyToken, [fallbackMessage()]);
      return;
    }

    await trackInteraction(userId, messageType, userText);
    await autoUpgradeSegment(userId);

    const leadReply = await continueLeadIfActive(userId, userText);
    if (leadReply) {
      await replyMessage(event.replyToken, [textMessage(leadReply)]);
      return;
    }

    const routed = await routeCommand(userId, userText);
    if (routed) {
      await replyMessage(event.replyToken, routed);
      return;
    }

    const item = await findContentByMessage(userText);
    await replyMessage(event.replyToken, item ? [buildContentFlex(item)] : [fallbackMessage()]);
  } catch (error) {
    log.error(error);
    await replyMessage(event.replyToken, [
      textMessage("ขออภัยครับ พระจันทร์ประมวลผลไม่สำเร็จชั่วคราว ลองใหม่อีกครั้งได้เลย")
    ]);
  }
}

async function continueLeadIfActive(userId, userText) {
  const activeSession = await getLeadSession(userId);
  if (!activeSession) return null;

  const result = await handleLeadAnswer(userId, userText);
  return result?.reply || null;
}

async function routeCommand(userId, text) {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, "");

  // "ต่อ" / "เพิ่ม" / "ต่อไป" → ดูหน้าถัดไป
  if (NEXT_KEYWORDS.includes(normalized)) {
    const session = getBrowse(userId);
    if (session) {
      return buildCategoryPage(userId, session.category, session.page + 1);
    }
    return [textMessage("ยังไม่ได้เลือกหมวด พิมพ์ชื่อหมวดก่อนนะครับ เช่น pdpa, sec, ai")];
  }

  // Category name (pdpa, sec, Sec, PDPA, AI, etc.) → หน้าแรก
  if (CATEGORIES[normalized]) {
    return buildCategoryPage(userId, normalized, 0);
  }

  // Clear browse session when switching to other commands
  clearBrowse(userId);

  if (["lead", "สนใจ", "ติดต่อกลับ"].includes(normalized)) {
    await startLeadFlow(userId, "general");
    return [textMessage("ขอทราบชื่อ-นามสกุล เพื่อให้พระจันทร์รู้จักคุณมากขึ้นได้ไหม?")];
  }

  if (normalized.includes("ติดต่อเจ้าหน้าที่")) {
    await startLeadFlow(userId, "human_support");
    return [textMessage("ได้ครับ ฝากชื่อ-นามสกุลไว้ก่อน แล้วทีมงานจะรับช่วงดูแลต่อให้")];
  }

  if (["kb", "knowledge", "ดูคลิป", "คลิป", "content", "คลังความรู้"].includes(normalized)) {
    const catList = Object.entries(CATEGORIES).map(([k, v]) => `  ${k} → ${v.label} (${v.desc})`).join("\n");
    return [textMessage(`📚 คลังความรู้ Prajan\n\nพิมพ์ชื่อหมวดเพื่อดูรายการ:\n${catList}\n\nหรือพิมพ์รหัสตรง เช่น sec01, pdpa05, ai03`)];
  }

  if (normalized.includes("สินค้า") || normalized.includes("บริการ")) {
    const item = await findContentByMessage("SERVICES");
    if (item) return [buildContentFlex(item)];
    return buildCategoryPage(userId, "svc", 0);
  }

  if (["ขอพร", "สุ่มพร", "พรประจำวัน", "ขอพรประจำวัน"].includes(normalized)) {
    const blessings = [
      "วันนี้ให้เริ่มจากสิ่งเล็กที่ชัดที่สุด แล้วคำตอบถัดไปจะสว่างขึ้นเอง",
      "พระจันทร์ขอให้คุณเจอทางลัดที่ไม่ลดคุณภาพ และมีแรงพอทำสิ่งสำคัญให้จบ",
      "คืนนี้เหมาะกับการตัดสิ่งรบกวน เหลือไว้แค่หนึ่งงานที่ควรเดินหน้า",
      "ปัญหาที่ดูใหญ่ตอนกลางคืนมักเล็กลงเมื่อเช้ามาถึง จดไว้แล้วพักก่อน",
      "ไม่มีใครชนะด้วยความรู้อย่างเดียว แต่ชนะด้วยการลงมือทำซ้ำจนชำนาญ",
    ];
    const blessing = blessings[Math.floor(Math.random() * blessings.length)];
    return [textMessage(`🌙 ${blessing}\n\n✨ แจ้งพร ความต้องการทางธุรกิจของท่านมาให้เรา ถ้าเราทำได้เราจะทำให้\n\nพิมพ์ 'kb' ดูคลังความรู้ หรือ 'ติดต่อเจ้าหน้าที่' เพื่อคุยกับทีมงาน`)];
  }

  if (normalized.includes("คืนจันทร์เพ็ญ") || normalized.includes("ความรู้คืน") || normalized.includes("moonwisdom")) {
    const wisdom = await getMoonWisdom();
    return [textMessage(wisdom)];
  }

  return null;
}

function requireAdmin(request, reply, done) {
  const expected = process.env.ADMIN_TOKEN;
  const actual = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!expected || actual !== expected) {
    reply.code(401).send({ ok: false, error: "Unauthorized" });
    return;
  }
  done();
}

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}${BASE_PATH}`).replace(/\/$/, "");
}

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

try {
  await app.listen({ port, host });
  console.log(`Prajan listening on http://${host}:${port}${BASE_PATH}`);
} catch (err) {
  console.error("Startup failed:", err);
  process.exit(1);
}

export default app;
