#!/usr/bin/env node
/**
 * Import Knowledge Base CSV → MariaDB content_items table
 *
 * วิธีใช้:
 *   node scripts/import-kb-to-db.js              # import ทั้งหมด
 *   node scripts/import-kb-to-db.js --dry-run    # preview only
 *
 * ต้องการ ENV: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

const CSV_PATH = resolve("data/knowledge-base-enriched.csv");
const DRY_RUN = process.argv.includes("--dry-run");

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

// ─── Category labels ───

const CATEGORY_LABELS = {
  pdpa: "PDPA",
  sec: "Security",
  ai: "AI",
  train: "Training",
  consent: "Consent/Cookie",
  dpo: "DPO",
  svc: "บริการ",
};

// ─── Main ───

async function main() {
  console.log(`${DRY_RUN ? "[DRY RUN] " : ""}Reading CSV...`);
  const entries = parseCSV(readFileSync(CSV_PATH, "utf-8"));
  console.log(`  ${entries.length} entries loaded\n`);

  let pool;
  if (!DRY_RUN) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "prajan",
      waitForConnections: true,
      connectionLimit: 5,
      namedPlaceholders: true,
    });
    console.log("Connected to database\n");
  }

  const stats = { inserted: 0, updated: 0, skipped: 0 };

  for (const entry of entries) {
    const code = entry["Keyword Code"];
    const title = entry["Video Title (ชื่อคลิป)"] || "";
    const url = entry["URL / Timestamp Link (ลิงก์วิดีโอ)"] || "";
    const summary = entry["Summary & Key Content (เนื้อหาสรุป)"] || "";
    const category = entry["Category"] || "";
    const tags = entry["Keywords / Tag"] || "";

    if (!code || !title) {
      stats.skipped++;
      continue;
    }

    // Build keyword for matching: category label + tags
    const keyword = [
      CATEGORY_LABELS[category] || category,
      ...tags.split(",").map((t) => t.trim()).filter(Boolean),
    ].join(", ");

    // Build body text
    const body = summary || `คลังความรู้ Prajan: ${title}`;

    // Truncate for DB field limits
    const item = {
      code: code.slice(0, 64),
      keyword: keyword.slice(0, 255),
      title: title.slice(0, 255),
      summary: (CATEGORY_LABELS[category] || category).slice(0, 65535),
      body: body.slice(0, 65535),
      media_url: null,
      action_label: "ดูคลิป",
      action_url: url.slice(0, 1000) || null,
      is_active: 1,
    };

    if (DRY_RUN) {
      if (stats.inserted < 5) {
        console.log(`  ${item.code} | ${item.title.slice(0, 50)}... | keyword: ${item.keyword.slice(0, 40)}...`);
      }
      stats.inserted++;
      continue;
    }

    try {
      await pool.execute(
        `INSERT INTO content_items
          (code, keyword, title, summary, body, media_url, action_label, action_url, is_active)
         VALUES
          (:code, :keyword, :title, :summary, :body, :media_url, :action_label, :action_url, :is_active)
         ON DUPLICATE KEY UPDATE
          keyword = VALUES(keyword),
          title = VALUES(title),
          summary = VALUES(summary),
          body = VALUES(body),
          media_url = VALUES(media_url),
          action_label = VALUES(action_label),
          action_url = VALUES(action_url),
          is_active = VALUES(is_active)`,
        item
      );
      stats.inserted++;
    } catch (err) {
      console.error(`  ERROR ${code}: ${err.message}`);
      stats.skipped++;
    }
  }

  if (DRY_RUN && stats.inserted > 5) {
    console.log(`  ... +${stats.inserted - 5} more`);
  }

  console.log(`\nDone!`);
  console.log(`  Inserted/Updated: ${stats.inserted}`);
  console.log(`  Skipped: ${stats.skipped}`);

  if (pool) await pool.end();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
