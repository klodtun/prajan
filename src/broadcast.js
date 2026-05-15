import { getPool } from "./db.js";
import { buildContentFlex, textMessage } from "./line.js";

const LINE_API_BASE = "https://api.line.me/v2/bot";

export async function createBroadcast(input) {
  const pool = getPool();
  const [result] = await pool.execute(
    `INSERT INTO broadcasts (target_segment, title, body, status, scheduled_at)
     VALUES (:segment, :title, :body, :status, :scheduledAt)`,
    {
      segment: input.target_segment || "all",
      title: input.title,
      body: input.body,
      status: input.scheduled_at ? "scheduled" : "draft",
      scheduledAt: input.scheduled_at || null
    }
  );
  return result.insertId;
}

export async function listBroadcasts() {
  const [rows] = await getPool().query(
    "SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT 100"
  );
  return rows;
}

export async function sendBroadcast(broadcastId) {
  const pool = getPool();
  const [rows] = await pool.execute("SELECT * FROM broadcasts WHERE id = :id", { id: broadcastId });
  const broadcast = rows[0];
  if (!broadcast) throw new Error("Broadcast not found");
  if (broadcast.status === "sent") throw new Error("Already sent");

  const userIds = await getTargetUserIds(broadcast.target_segment);
  if (userIds.length === 0) {
    await pool.execute(
      "UPDATE broadcasts SET status = 'sent', sent_at = NOW() WHERE id = :id",
      { id: broadcastId }
    );
    return { sent: 0 };
  }

  const messages = [textMessage(`📢 ${broadcast.title}\n\n${broadcast.body}`)];

  const batchSize = 500;
  let totalSent = 0;
  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize);
    await multicastMessage(batch, messages);
    totalSent += batch.length;
  }

  await pool.execute(
    "UPDATE broadcasts SET status = 'sent', sent_at = NOW() WHERE id = :id",
    { id: broadcastId }
  );

  return { sent: totalSent };
}

async function getTargetUserIds(segment) {
  let query;
  const params = {};

  if (segment === "all") {
    query = "SELECT DISTINCT line_user_id FROM leads WHERE status = 'active'";
  } else if (segment === "individual") {
    return [];
  } else {
    query = "SELECT DISTINCT line_user_id FROM leads WHERE status = 'active' AND segment = :segment";
    params.segment = segment;
  }

  const [rows] = await getPool().execute(query, params);
  return rows.map((r) => r.line_user_id);
}

export async function sendIndividualMessage(lineUserId, messageText) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is required");

  const res = await fetch(`${LINE_API_BASE}/message/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [textMessage(messageText)]
    })
  });

  if (!res.ok) {
    throw new Error(`Push message failed: ${res.status} ${await res.text()}`);
  }
}

async function multicastMessage(userIds, messages) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is required");

  const res = await fetch(`${LINE_API_BASE}/message/multicast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ to: userIds, messages })
  });

  if (!res.ok) {
    throw new Error(`Multicast failed: ${res.status} ${await res.text()}`);
  }
}
