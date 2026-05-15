import crypto from "node:crypto";

const LINE_API_BASE = "https://api-data.line.me/v2/bot";
const LINE_MESSAGING_BASE = "https://api.line.me/v2/bot";

export function verifyLineSignature(rawBody, signature) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");

  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

export async function replyMessage(replyToken, messages) {
  if (!replyToken || !process.env.LINE_CHANNEL_ACCESS_TOKEN) return;

  const response = await fetch(`${LINE_MESSAGING_BASE}/message/reply`, {
    method: "POST",
    headers: lineHeaders(),
    body: JSON.stringify({ replyToken, messages })
  });

  if (!response.ok) {
    throw new Error(`LINE reply failed: ${response.status} ${await response.text()}`);
  }
}

export async function getLineMessageContent(messageId) {
  const response = await fetch(`${LINE_API_BASE}/message/${messageId}/content`, {
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
    }
  });

  if (!response.ok) {
    throw new Error(`LINE content fetch failed: ${response.status} ${await response.text()}`);
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "audio/m4a"
  };
}

export async function transcribeAudio(buffer, contentType = "audio/m4a") {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  const extension = contentType.includes("mpeg") ? "mp3" : "m4a";
  const form = new FormData();
  form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
  form.append("language", "th");
  form.append(
    "prompt",
    "ถอดเสียงข้อความภาษาไทยหรืออังกฤษจากผู้ใช้ LINE OA Prajan โดยคงรหัสสินค้า เช่น AI01 ให้ชัดเจน"
  );
  form.append("file", new Blob([buffer], { type: contentType }), `line-voice.${extension}`);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: form
  });

  if (!response.ok) {
    throw new Error(`OpenAI transcription failed: ${response.status} ${await response.text()}`);
  }

  const json = await response.json();
  return json.text || "";
}

export function buildContentFlex(item) {
  const contents = [
    {
      type: "text",
      text: item.title,
      weight: "bold",
      size: "lg",
      wrap: true,
      color: "#f6f0ff"
    },
    {
      type: "text",
      text: item.summary || `รหัส ${item.code}`,
      size: "sm",
      wrap: true,
      color: "#cfc7df",
      margin: "sm"
    },
    {
      type: "separator",
      margin: "lg",
      color: "#57456e"
    },
    {
      type: "text",
      text: item.body,
      size: "sm",
      wrap: true,
      color: "#fffaf2",
      margin: "lg"
    }
  ];

  if (item.action_url) {
    contents.push({
      type: "button",
      style: "primary",
      color: "#8f7add",
      margin: "lg",
      action: {
        type: "uri",
        label: item.action_label || "เปิดดูเพิ่มเติม",
        uri: item.action_url
      }
    });
  }

  return {
    type: "flex",
    altText: item.title,
    contents: {
      type: "bubble",
      hero: item.media_url
        ? {
            type: "image",
            url: item.media_url,
            size: "full",
            aspectRatio: "20:13",
            aspectMode: "cover"
          }
        : undefined,
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#21152f",
        contents
      }
    }
  };
}

export function textMessage(text) {
  return { type: "text", text };
}

export function welcomeMessage() {
  return textMessage(
    "สวัสดี เรา prajan (พระจันทร์) แสงสว่างนำทางในค่ำคืนที่สับสน คุณสนใจเรื่องอะไรบอกเราได้เลย หรือจะลอง 'ขอพร' (พิมพ์รหัส) ดูก็ได้นะ"
  );
}

export function fallbackMessage() {
  return textMessage(
    "พระจันทร์ยังไม่พบข้อมูลนี้ครับ ลองพิมพ์รหัส เช่น AI01, พิมพ์ 'สินค้า', พิมพ์ 'ขอพร' หรือพิมพ์ 'ติดต่อเจ้าหน้าที่' ได้เลย"
  );
}

function lineHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
  };
}
