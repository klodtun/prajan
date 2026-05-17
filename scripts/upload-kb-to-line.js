#!/usr/bin/env node
/**
 * Upload Knowledge Base → LINE OA Auto-Response Keywords
 *
 * ใช้ LINE Messaging API ตั้ง keyword auto-reply ใน LINE OA
 * ให้ลูกค้าพิมพ์รหัส (เช่น sec01, pdpa05) แล้วได้ Flex Message ตอบกลับทันที
 *
 * วิธีใช้:
 *   node scripts/upload-kb-to-line.js                # upload ทั้งหมด
 *   node scripts/upload-kb-to-line.js --test USER_ID # ทดสอบส่งให้ตัวเอง
 *
 * ต้องการ ENV:
 *   LINE_CHANNEL_ACCESS_TOKEN
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CSV_PATH = resolve("data/knowledge-base-enriched.csv");
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";

// ─── CSV Parser ───

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

// ─── Flex Message Builders ───

const CAT_LABELS = {
  pdpa: "PDPA", sec: "Security", ai: "AI",
  train: "Training", consent: "Consent", dpo: "DPO", svc: "บริการ",
};
const CAT_COLORS = {
  pdpa: "#5B21B6", sec: "#DC2626", ai: "#2563EB",
  train: "#059669", consent: "#D97706", dpo: "#7C3AED", svc: "#0891B2",
};

function buildFlexBubble(entry) {
  const title = entry["Video Title (ชื่อคลิป)"] || "ไม่มีชื่อ";
  const url = entry["URL / Timestamp Link (ลิงก์วิดีโอ)"] || "";
  const summary = entry["Summary & Key Content (เนื้อหาสรุป)"] || "";
  const code = entry["Keyword Code"] || "";
  const cat = entry["Category"] || "";

  const contents = [
    {
      type: "box", layout: "horizontal",
      contents: [{ type: "text", text: CAT_LABELS[cat] || cat, size: "xxs", color: "#ffffff", weight: "bold", align: "center" }],
      backgroundColor: CAT_COLORS[cat] || "#6B7280",
      cornerRadius: "md", paddingAll: "4px", paddingStart: "8px", paddingEnd: "8px", width: "100px",
    },
    { type: "text", text: title.slice(0, 80), weight: "bold", size: "md", wrap: true, color: "#1a1a2e", margin: "md" },
    { type: "text", text: `รหัส: ${code}`, size: "xs", color: "#8f7add", margin: "sm" },
    { type: "separator", margin: "lg", color: "#e0d6f0" },
    { type: "text", text: (summary || `เนื้อหาเกี่ยวกับ ${CAT_LABELS[cat] || cat}`).slice(0, 150), size: "sm", wrap: true, color: "#555555", margin: "lg" },
  ];

  if (url) {
    contents.push({
      type: "button", style: "primary", color: "#8f7add", margin: "lg", height: "sm",
      action: { type: "uri", label: "ดูคลิป", uri: url },
    });
  }

  return {
    type: "flex",
    altText: `${code}: ${title.slice(0, 40)}`,
    contents: { type: "bubble", size: "kilo", body: { type: "box", layout: "vertical", contents, backgroundColor: "#ffffff", paddingAll: "16px" } },
  };
}

function buildCategoryCarousel(cat, items) {
  const bubbles = items.slice(0, 10).map((entry) => {
    const title = entry["Video Title (ชื่อคลิป)"] || "";
    const code = entry["Keyword Code"] || "";
    const url = entry["URL / Timestamp Link (ลิงก์วิดีโอ)"] || "";
    return {
      type: "bubble", size: "kilo",
      body: {
        type: "box", layout: "vertical", backgroundColor: "#ffffff", paddingAll: "14px",
        contents: [
          { type: "text", text: title.slice(0, 60), weight: "bold", size: "sm", wrap: true, color: "#1a1a2e" },
          { type: "text", text: `รหัส: ${code}`, size: "xxs", color: "#8f7add", margin: "sm" },
        ],
        action: url ? { type: "uri", label: "ดู", uri: url } : { type: "message", label: "ดู", text: code },
      },
    };
  });

  // Summary bubble
  bubbles.push({
    type: "bubble", size: "kilo",
    body: {
      type: "box", layout: "vertical", backgroundColor: "#f8f5ff", paddingAll: "16px",
      contents: [
        { type: "text", text: `${CAT_LABELS[cat] || cat}`, weight: "bold", size: "lg", color: "#1a1a2e" },
        { type: "text", text: `ทั้งหมด ${items.length} รายการ`, size: "sm", color: "#888", margin: "sm" },
        { type: "separator", margin: "lg" },
        { type: "text", text: `พิมพ์รหัส ${cat}01 ถึง ${cat}${String(items.length).padStart(2, "0")} เพื่อดูแต่ละเรื่อง`, size: "sm", wrap: true, color: "#555", margin: "lg" },
      ],
    },
  });

  return {
    type: "flex",
    altText: `${CAT_LABELS[cat] || cat} (${items.length} รายการ) - พิมพ์รหัส ${cat}01-${cat}${String(items.length).padStart(2, "0")}`,
    contents: { type: "carousel", contents: bubbles.slice(0, 12) },
  };
}

// ─── LINE API ───

async function pushMessage(userId, messages) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ to: userId, messages }),
  });
  if (!res.ok) throw new Error(`Push failed: ${res.status} ${await res.text()}`);
}

// ─── Main ───

async function main() {
  const testMode = process.argv.includes("--test");
  const testUserId = process.argv[process.argv.indexOf("--test") + 1];

  console.log("Reading CSV...");
  const entries = parseCSV(readFileSync(CSV_PATH, "utf-8"));
  console.log(`  ${entries.length} entries loaded`);

  // Group
  const grouped = {};
  for (const entry of entries) {
    const cat = entry["Category"] || "other";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(entry);
  }

  console.log("\nCategories:");
  for (const [cat, items] of Object.entries(grouped)) {
    console.log(`  ${cat}: ${items.length} items (${cat}01 - ${cat}${String(items.length).padStart(2, "0")})`);
  }

  // Generate JSON export
  const allResponses = {};

  for (const entry of entries) {
    const code = entry["Keyword Code"];
    if (!code) continue;
    allResponses[code] = buildFlexBubble(entry);
  }

  for (const [cat, items] of Object.entries(grouped)) {
    allResponses[cat] = buildCategoryCarousel(cat, items);
  }

  const outputPath = resolve("data/line-autoreply-messages.json");
  writeFileSync(outputPath, JSON.stringify(allResponses, null, 2), "utf-8");
  console.log(`\nGenerated ${Object.keys(allResponses).length} auto-reply messages → ${outputPath}`);

  // Test mode: send sample to user
  if (testMode && testUserId) {
    if (!TOKEN) {
      console.error("ERROR: LINE_CHANNEL_ACCESS_TOKEN is required for --test mode. Set it in .env");
      process.exit(1);
    }
    console.log(`\nTest mode: sending samples to ${testUserId}...`);

    // Send one category carousel
    const firstCat = Object.keys(grouped)[0];
    console.log(`  Sending ${firstCat} carousel...`);
    await pushMessage(testUserId, [allResponses[firstCat]]);

    // Send one individual entry
    const firstCode = entries[0]["Keyword Code"];
    console.log(`  Sending ${firstCode} bubble...`);
    await pushMessage(testUserId, [allResponses[firstCode]]);

    console.log("  Test messages sent!");
  }

  console.log("\n✅ สำเร็จ!");
  console.log("\nวิธีใช้งานต่อ:");
  console.log("  ลูกค้าพิมพ์รหัส เช่น:");
  console.log("    'sec'      → ดูรายการ Security ทั้งหมด (carousel)");
  console.log("    'sec01'    → ดูรายละเอียดเฉพาะเรื่อง");
  console.log("    'pdpa'     → ดูรายการ PDPA ทั้งหมด");
  console.log("    'ai05'     → ดูเรื่อง AI ลำดับที่ 5");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
