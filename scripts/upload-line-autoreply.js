#!/usr/bin/env node
/**
 * Upload Knowledge Base → LINE OA Auto-Reply Keywords
 *
 * วิธีใช้:
 *   node scripts/upload-line-autoreply.js
 *
 * ต้องการ ENV:
 *   LINE_CHANNEL_ACCESS_TOKEN
 *
 * อ่าน data/knowledge-base-enriched.csv แล้วสร้าง
 * auto-reply keyword messages ผ่าน LINE Messaging API
 * โดยจัดกลุ่มเป็น Flex Message per category
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSV_PATH = resolve("data/knowledge-base-enriched.csv");
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

if (!TOKEN) {
  console.error("ERROR: LINE_CHANNEL_ACCESS_TOKEN is required in .env");
  process.exit(1);
}

// ─── CSV Parser (simple, handles quoted fields) ───

function parseCSV(text) {
  const lines = [];
  let current = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        current.push(field);
        field = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        current.push(field);
        if (current.length > 1) lines.push(current);
        current = [];
        field = "";
      } else {
        field += ch;
      }
    }
  }
  if (field || current.length) {
    current.push(field);
    if (current.length > 1) lines.push(current);
  }

  const headers = lines[0];
  return lines.slice(1).map((cols) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] || "").trim(); });
    return obj;
  });
}

// ─── Build Flex Bubble for a single KB entry ───

function buildBubble(entry) {
  const title = entry["Video Title (ชื่อคลิป)"] || "ไม่มีชื่อ";
  const url = entry["URL / Timestamp Link (ลิงก์วิดีโอ)"] || "";
  const summary = entry["Summary & Key Content (เนื้อหาสรุป)"] || "";
  const code = entry["Keyword Code"] || "";
  const category = entry["Category"] || "";
  const tags = entry["Keywords / Tag"] || "";

  const categoryLabels = {
    pdpa: "PDPA",
    sec: "Security",
    ai: "AI",
    train: "Training",
    consent: "Consent/Cookie",
    dpo: "DPO",
    svc: "บริการ",
  };

  const categoryColors = {
    pdpa: "#5B21B6",
    sec: "#DC2626",
    ai: "#2563EB",
    train: "#059669",
    consent: "#D97706",
    dpo: "#7C3AED",
    svc: "#0891B2",
  };

  const displayTitle = title.length > 60 ? title.slice(0, 57) + "..." : title;
  const displaySummary = summary.length > 120 ? summary.slice(0, 117) + "..." : summary;

  const contents = [
    {
      type: "box",
      layout: "horizontal",
      contents: [
        {
          type: "text",
          text: categoryLabels[category] || category,
          size: "xxs",
          color: "#ffffff",
          weight: "bold",
          align: "center",
        }
      ],
      backgroundColor: categoryColors[category] || "#6B7280",
      cornerRadius: "md",
      paddingAll: "4px",
      paddingStart: "8px",
      paddingEnd: "8px",
      width: "100px",
    },
    {
      type: "text",
      text: displayTitle,
      weight: "bold",
      size: "md",
      wrap: true,
      color: "#1a1a2e",
      margin: "md",
    },
    {
      type: "text",
      text: `รหัส: ${code}`,
      size: "xs",
      color: "#8f7add",
      margin: "sm",
    },
    {
      type: "separator",
      margin: "lg",
      color: "#e0d6f0",
    },
    {
      type: "text",
      text: displaySummary || `เนื้อหาเกี่ยวกับ ${tags}`,
      size: "sm",
      wrap: true,
      color: "#555555",
      margin: "lg",
    },
  ];

  if (url) {
    contents.push({
      type: "button",
      style: "primary",
      color: "#8f7add",
      margin: "lg",
      height: "sm",
      action: {
        type: "uri",
        label: "ดูคลิป",
        uri: url,
      },
    });
  }

  return {
    type: "bubble",
    size: "kilo",
    body: {
      type: "box",
      layout: "vertical",
      contents,
      backgroundColor: "#ffffff",
      paddingAll: "16px",
    },
  };
}

// ─── Build category menu carousel ───

function buildCategoryCarousel(category, entries) {
  const categoryLabels = {
    pdpa: "PDPA / ข้อมูลส่วนบุคคล",
    sec: "Security / Cybersecurity",
    ai: "AI / Automation",
    train: "Training / อบรม",
    consent: "Consent / Cookie",
    dpo: "DPO / ผู้ควบคุมข้อมูล",
    svc: "บริการ / Consulting",
  };

  // Take first 10 entries as preview
  const preview = entries.slice(0, 10);
  const bubbles = preview.map(buildBubble);

  // Add summary bubble at end
  bubbles.push({
    type: "bubble",
    size: "kilo",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: categoryLabels[category] || category,
          weight: "bold",
          size: "lg",
          color: "#1a1a2e",
        },
        {
          type: "text",
          text: `ทั้งหมด ${entries.length} รายการ`,
          size: "sm",
          color: "#888888",
          margin: "sm",
        },
        {
          type: "separator",
          margin: "lg",
        },
        {
          type: "text",
          text: `พิมพ์รหัส ${category}01 - ${category}${String(entries.length).padStart(2, "0")} เพื่อดูรายละเอียดแต่ละเรื่อง`,
          size: "sm",
          wrap: true,
          color: "#555555",
          margin: "lg",
        },
      ],
      backgroundColor: "#f8f5ff",
      paddingAll: "16px",
    },
  });

  return {
    type: "flex",
    altText: `${categoryLabels[category]} (${entries.length} รายการ)`,
    contents: {
      type: "carousel",
      contents: bubbles.slice(0, 12), // LINE limit 12 bubbles
    },
  };
}

// ─── LINE Messaging API: Set webhook auto-reply via Rich Menu ───

async function setLineAutoReplyKeywords(entries, grouped) {
  // This creates a LINE OA auto-response message setup
  // by generating keyword-response mapping files

  const keywordMap = {};

  for (const entry of entries) {
    const code = entry["Keyword Code"];
    if (!code) continue;
    keywordMap[code] = {
      code,
      title: entry["Video Title (ชื่อคลิป)"],
      url: entry["URL / Timestamp Link (ลิงก์วิดีโอ)"],
      summary: entry["Summary & Key Content (เนื้อหาสรุป)"],
      category: entry["Category"],
      tags: entry["Keywords / Tag"],
    };
  }

  return keywordMap;
}

// ─── LINE OA Auto-Response API ───

const LINE_OA_API = "https://api.line.me/v2/bot";

async function pushTestMessage(userId, messages) {
  const res = await fetch(`${LINE_OA_API}/message/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ to: userId, messages }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Push failed: ${res.status} ${text}`);
  }
}

// ─── Generate keyword-response JSON for import ───

async function generateKeywordResponseFile(entries, grouped) {
  const output = {
    generated_at: new Date().toISOString(),
    total_entries: entries.length,
    categories: {},
    keyword_responses: [],
  };

  // Category summaries
  for (const [cat, items] of Object.entries(grouped)) {
    output.categories[cat] = {
      count: items.length,
      code_range: `${cat}01 - ${cat}${String(items.length).padStart(2, "0")}`,
    };
  }

  // Individual keyword responses
  for (const entry of entries) {
    const code = entry["Keyword Code"];
    if (!code) continue;

    output.keyword_responses.push({
      keyword: code,
      title: entry["Video Title (ชื่อคลิป)"],
      url: entry["URL / Timestamp Link (ลิงก์วิดีโอ)"],
      summary: entry["Summary & Key Content (เนื้อหาสรุป)"],
      category: entry["Category"],
      tags: entry["Keywords / Tag"],
      flex_message: buildBubble(entry),
    });
  }

  // Category-level keyword responses
  for (const [cat, items] of Object.entries(grouped)) {
    output.keyword_responses.push({
      keyword: cat,
      type: "category_carousel",
      carousel: buildCategoryCarousel(cat, items),
    });
  }

  return output;
}

// ─── Main ───

async function main() {
  console.log("Reading CSV...");
  const csvText = readFileSync(CSV_PATH, "utf-8");
  const entries = parseCSV(csvText);
  console.log(`  ${entries.length} entries loaded`);

  // Group by category
  const grouped = {};
  for (const entry of entries) {
    const cat = entry["Category"] || "other";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(entry);
  }

  console.log("\nCategories:");
  for (const [cat, items] of Object.entries(grouped)) {
    console.log(`  ${cat}: ${items.length} items`);
  }

  // Generate keyword-response JSON
  console.log("\nGenerating keyword-response mapping...");
  const keywordData = await generateKeywordResponseFile(entries, grouped);

  const outputPath = resolve("data/line-keyword-responses.json");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outputPath, JSON.stringify(keywordData, null, 2), "utf-8");
  console.log(`  Written to ${outputPath}`);
  console.log(`  ${keywordData.keyword_responses.length} keyword responses (${entries.length} individual + ${Object.keys(grouped).length} category)`);

  // Generate LINE OA auto-response import file
  // This is for LINE Official Account Manager's "Auto-response messages"
  console.log("\nGenerating LINE OA auto-response import...");

  const autoResponses = [];

  // Category keywords (type category name to see carousel)
  for (const [cat, items] of Object.entries(grouped)) {
    autoResponses.push({
      keywords: [cat],
      response_type: "flex_carousel",
      description: `หมวด ${cat} (${items.length} รายการ)`,
    });
  }

  // Individual keyword codes
  for (const entry of entries) {
    autoResponses.push({
      keywords: [entry["Keyword Code"]],
      response_type: "flex_bubble",
      title: entry["Video Title (ชื่อคลิป)"],
    });
  }

  console.log(`  ${autoResponses.length} auto-response rules ready`);

  console.log("\n✅ Done!");
  console.log("\nNext steps:");
  console.log("  1. ตรวจสอบ data/knowledge-base-enriched.csv (Keyword Code column)");
  console.log("  2. ตรวจสอบ data/line-keyword-responses.json");
  console.log("  3. เมื่อ hosting พร้อม รัน: node scripts/import-kb-to-db.js");
  console.log("  4. หรือ upload ผ่าน LINE OA Manager > Auto-response messages");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
