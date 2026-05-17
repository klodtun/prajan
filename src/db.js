import mysql from "mysql2/promise";

let pool;

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "prajan",
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true
    });
  }

  return pool;
}

export async function findContentByMessage(message) {
  const query = normalize(message);
  if (!query) return null;

  const terms = searchTerms(query);
  const params = {
    query,
    qlike: `%${query}%`
  };

  const termConditions = terms.map((term, index) => {
    params[`term${index}`] = `%${term}%`;
    return `(LOWER(keyword) LIKE :term${index}
      OR LOWER(title) LIKE :term${index}
      OR LOWER(summary) LIKE :term${index}
      OR LOWER(body) LIKE :term${index})`;
  });

  const termScore = terms.map((_term, index) => (
    `(CASE WHEN LOWER(keyword) LIKE :term${index} THEN 6 ELSE 0 END
      + CASE WHEN LOWER(title) LIKE :term${index} THEN 4 ELSE 0 END
      + CASE WHEN LOWER(summary) LIKE :term${index} THEN 3 ELSE 0 END
      + CASE WHEN LOWER(body) LIKE :term${index} THEN 1 ELSE 0 END)`
  )).join(" + ") || "0";

  const [rows] = await getPool().execute(
    `SELECT id, code, keyword, title, summary, body, media_url, action_label, action_url
     FROM content_items
     WHERE is_active = 1
       AND (
         LOWER(code) = LOWER(:query)
         OR LOWER(keyword) = LOWER(:query)
         OR LOWER(keyword) LIKE :qlike
         OR LOWER(title) LIKE :qlike
         OR LOWER(summary) LIKE :qlike
         OR LOWER(body) LIKE :qlike
         ${termConditions.length ? `OR ${termConditions.join(" OR ")}` : ""}
       )
     ORDER BY
       CASE
         WHEN LOWER(code) = LOWER(:query) THEN 1
         WHEN LOWER(keyword) = LOWER(:query) THEN 2
         WHEN LOWER(keyword) LIKE :qlike THEN 3
         WHEN LOWER(title) LIKE :qlike THEN 4
         ELSE 5
       END,
       (${termScore}) DESC,
       updated_at DESC
     LIMIT 1`,
    params
  );

  return rows[0] || null;
}

export async function listContentByCategory(category) {
  const pattern = `${category}%`;
  const [rows] = await getPool().execute(
    `SELECT id, code, title FROM content_items
     WHERE is_active = 1 AND LOWER(code) LIKE LOWER(:pattern)
     ORDER BY code ASC`,
    { pattern }
  );
  return rows;
}

export async function listContentItems() {
  const [rows] = await getPool().query(
    `SELECT id, code, keyword, title, summary, body, media_url, action_label, action_url, is_active, updated_at
     FROM content_items
     ORDER BY updated_at DESC, id DESC`
  );
  return rows;
}

export async function upsertContentItem(input) {
  const item = {
    id: input.id || null,
    code: clean(input.code),
    keyword: clean(input.keyword),
    title: clean(input.title),
    summary: clean(input.summary),
    body: clean(input.body),
    media_url: clean(input.media_url),
    action_label: clean(input.action_label) || "เปิดดูเพิ่มเติม",
    action_url: clean(input.action_url),
    is_active: input.is_active === false || input.is_active === 0 ? 0 : 1
  };

  if (!item.code || !item.keyword || !item.title || !item.body) {
    const error = new Error("code, keyword, title and body are required");
    error.statusCode = 400;
    throw error;
  }

  if (item.id) {
    await getPool().execute(
      `UPDATE content_items
       SET code = :code, keyword = :keyword, title = :title, summary = :summary,
           body = :body, media_url = :media_url, action_label = :action_label,
           action_url = :action_url, is_active = :is_active
       WHERE id = :id`,
      item
    );
    return item.id;
  }

  const [result] = await getPool().execute(
    `INSERT INTO content_items
      (code, keyword, title, summary, body, media_url, action_label, action_url, is_active)
     VALUES
      (:code, :keyword, :title, :summary, :body, :media_url, :action_label, :action_url, :is_active)`,
    item
  );
  return result.insertId;
}

export async function startLeadFlow(userId, topic = "general") {
  await getPool().execute(
    `INSERT INTO lead_sessions (line_user_id, topic, step)
     VALUES (:userId, :topic, 'ask_name')
     ON DUPLICATE KEY UPDATE topic = VALUES(topic), step = 'ask_name', updated_at = CURRENT_TIMESTAMP`,
    { userId, topic }
  );
}

export async function getLeadSession(userId) {
  const [rows] = await getPool().execute(
    "SELECT * FROM lead_sessions WHERE line_user_id = :userId LIMIT 1",
    { userId }
  );
  return rows[0] || null;
}

export async function handleLeadAnswer(userId, text) {
  const session = await getLeadSession(userId);
  if (!session) return null;

  if (session.step === "ask_name") {
    await getPool().execute(
      `UPDATE lead_sessions
       SET full_name = :fullName, step = 'ask_phone'
       WHERE line_user_id = :userId`,
      { userId, fullName: clean(text) }
    );
    return {
      done: false,
      reply: "ขอบคุณครับ ขอเบอร์ติดต่อสำหรับรับสิทธิพิเศษหรือให้เจ้าหน้าที่ดูแลต่อได้ไหม?"
    };
  }

  if (session.step === "ask_phone") {
    await getPool().execute(
      `INSERT INTO leads (line_user_id, topic, full_name, phone, segment)
       VALUES (:userId, :topic, :fullName, :phone, 'newbie')
       ON DUPLICATE KEY UPDATE topic = VALUES(topic), full_name = VALUES(full_name),
         phone = VALUES(phone), segment = 'newbie', updated_at = CURRENT_TIMESTAMP`,
      {
        userId,
        topic: session.topic,
        fullName: session.full_name,
        phone: clean(text)
      }
    );
    await getPool().execute("DELETE FROM lead_sessions WHERE line_user_id = :userId", { userId });
    return {
      done: true,
      reply: "รับข้อมูลไว้แล้วครับ พระจันทร์จะให้ทีมงานติดต่อกลับพร้อมข้อมูลที่เหมาะกับคุณ"
    };
  }

  return null;
}

export async function trackInteraction(userId, messageType, messageText) {
  await getPool().execute(
    `INSERT INTO interactions (line_user_id, message_type, message_text)
     VALUES (:userId, :messageType, :messageText)`,
    {
      userId: userId || "unknown",
      messageType,
      messageText: messageText ? messageText.slice(0, 1000) : null
    }
  );
}

export async function listLeads(filters = {}) {
  let query = "SELECT * FROM leads WHERE 1=1";
  const params = {};

  if (filters.segment) {
    query += " AND segment = :segment";
    params.segment = filters.segment;
  }
  if (filters.status) {
    query += " AND status = :status";
    params.status = filters.status;
  }

  query += " ORDER BY updated_at DESC LIMIT 200";
  const [rows] = await getPool().execute(query, params);
  return rows;
}

export async function updateLead(lineUserId, updates) {
  const allowed = {};
  if (updates.segment) allowed.segment = updates.segment;
  if (updates.status) allowed.status = updates.status;

  if (Object.keys(allowed).length === 0) return;

  const sets = Object.keys(allowed).map((k) => `${k} = :${k}`).join(", ");
  allowed.userId = lineUserId;

  await getPool().execute(
    `UPDATE leads SET ${sets} WHERE line_user_id = :userId`,
    allowed
  );
}

export async function autoUpgradeSegment(userId) {
  const [rows] = await getPool().execute(
    `SELECT COUNT(*) AS cnt FROM interactions
     WHERE line_user_id = :userId`,
    { userId }
  );

  const count = rows[0]?.cnt || 0;
  if (count < 5) return;

  await getPool().execute(
    `UPDATE leads SET segment = 'loyal'
     WHERE line_user_id = :userId AND segment = 'newbie'`,
    { userId }
  );
}

export async function getLeadByUserId(userId) {
  const [rows] = await getPool().execute(
    "SELECT * FROM leads WHERE line_user_id = :userId LIMIT 1",
    { userId }
  );
  return rows[0] || null;
}

export async function getMoonWisdom() {
  const wisdoms = [
    "คืนจันทร์เพ็ญ: ตัดสิ่งที่กินเวลาแต่ไม่คืนค่า เหลือพื้นที่ให้สิ่งที่สำคัญจริง",
    "คืนจันทร์เพ็ญ: คนที่รอจังหวะที่ใช่ก็ดี แต่คนที่สร้างจังหวะเองดีกว่า",
    "คืนจันทร์เพ็ญ: ปัญหาที่ดูใหญ่ตอนกลางคืนมักเล็กลงเมื่อเช้ามาถึง จดไว้แล้วพักก่อน",
    "คืนจันทร์เพ็ญ: ไม่มีใครชนะด้วยความรู้อย่างเดียว แต่ชนะด้วยการลงมือทำซ้ำจนชำนาญ",
    "คืนจันทร์เพ็ญ: บางทีคำตอบไม่ได้อยู่ข้างหน้า แต่อยู่ในสิ่งที่คุณเลือกจะไม่ทำ"
  ];
  return wisdoms[Math.floor(Math.random() * wisdoms.length)];
}

function normalize(value) {
  return clean(value).toLowerCase();
}

function clean(value) {
  return String(value || "").trim();
}

function searchTerms(value) {
  const stopWords = new Set([
    "คือ",
    "อะไร",
    "อย่างไร",
    "ยังไง",
    "ช่วย",
    "ขอ",
    "ดู",
    "คลิป",
    "เรื่อง",
    "เกี่ยวกับ",
    "the",
    "and",
    "for",
    "with"
  ]);

  return [...new Set(
    clean(value)
      .toLowerCase()
      .split(/[^\p{L}\p{N}_-]+/u)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2 && !stopWords.has(term))
  )].slice(0, 8);
}
