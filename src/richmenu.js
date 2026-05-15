const LINE_API_BASE = "https://api.line.me/v2/bot";

export async function createRichMenu() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is required");

  const menu = {
    size: { width: 2500, height: 843 },
    selected: true,
    name: "prajan-main-menu",
    chatBarText: "เมนู Prajan",
    areas: [
      {
        bounds: { x: 0, y: 0, width: 833, height: 843 },
        action: { type: "message", text: "ดูคลิป" }
      },
      {
        bounds: { x: 833, y: 0, width: 834, height: 843 },
        action: { type: "message", text: "สินค้าและบริการ" }
      },
      {
        bounds: { x: 1667, y: 0, width: 833, height: 843 },
        action: { type: "message", text: "ติดต่อเจ้าหน้าที่" }
      }
    ]
  };

  const createRes = await fetch(`${LINE_API_BASE}/richmenu`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(menu)
  });

  if (!createRes.ok) {
    throw new Error(`Create rich menu failed: ${createRes.status} ${await createRes.text()}`);
  }

  const { richMenuId } = await createRes.json();
  return richMenuId;
}

export async function uploadRichMenuImage(richMenuId, imageBuffer, contentType = "image/png") {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  const res = await fetch(
    `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
    {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        Authorization: `Bearer ${token}`
      },
      body: imageBuffer
    }
  );

  if (!res.ok) {
    throw new Error(`Upload rich menu image failed: ${res.status} ${await res.text()}`);
  }
}

export async function setDefaultRichMenu(richMenuId) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  const res = await fetch(`${LINE_API_BASE}/user/all/richmenu/${richMenuId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    throw new Error(`Set default rich menu failed: ${res.status} ${await res.text()}`);
  }
}

export async function listRichMenus() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  const res = await fetch(`${LINE_API_BASE}/richmenu/list`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    throw new Error(`List rich menus failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.richmenus || [];
}

export async function deleteRichMenu(richMenuId) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  const res = await fetch(`${LINE_API_BASE}/richmenu/${richMenuId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    throw new Error(`Delete rich menu failed: ${res.status} ${await res.text()}`);
  }
}
