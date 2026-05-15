export function privacyHtml(baseUrl) {
  return documentPage(
    "นโยบายความเป็นส่วนตัว | Prajan",
    "นโยบายความเป็นส่วนตัว",
    `
      <p>Prajan (พระจันทร์) ให้ความสำคัญกับความเป็นส่วนตัวของผู้ใช้ LINE Official Account @052tqjbs</p>
      <h2>ข้อมูลที่เราเก็บ</h2>
      <p>เราอาจเก็บ LINE user ID, ข้อความที่ผู้ใช้ส่ง, รหัสคำสั่งที่ค้นหา, ชื่อ-นามสกุล, เบอร์ติดต่อ และข้อมูลความสนใจที่ผู้ใช้ให้ไว้โดยสมัครใจ</p>
      <h2>วัตถุประสงค์</h2>
      <p>ข้อมูลถูกใช้เพื่อให้ chatbot ตอบคำถาม, ส่งข้อมูลสินค้า/บริการ, ติดต่อกลับ, แยกกลุ่มผู้สนใจ และปรับปรุงประสบการณ์การใช้งาน</p>
      <h2>การส่งต่อข้อมูล</h2>
      <p>เราจะไม่ขายข้อมูลส่วนบุคคล และจะเปิดเผยข้อมูลเท่าที่จำเป็นต่อผู้ให้บริการระบบ, ผู้ดูแลบัญชี หรือเมื่อมีกฎหมายกำหนด</p>
      <h2>สิทธิของผู้ใช้</h2>
      <p>ผู้ใช้สามารถขอเข้าถึง แก้ไข หรือลบข้อมูลได้โดยติดต่อผู้ดูแล Prajan ผ่าน LINE OA หรือช่องทางติดต่อที่ประกาศไว้</p>
      <h2>ระยะเวลาจัดเก็บ</h2>
      <p>ข้อมูลจะถูกเก็บเท่าที่จำเป็นต่อการให้บริการและการติดตามลูกค้า เว้นแต่ผู้ใช้ร้องขอให้ลบหรือมีกฎหมายกำหนดเป็นอย่างอื่น</p>
      <p class="muted">Webhook URL: ${escapeHtml(baseUrl)}/webhook</p>
    `
  );
}

export function termsHtml() {
  return documentPage(
    "ข้อกำหนดการใช้บริการ | Prajan",
    "ข้อกำหนดการใช้บริการ",
    `
      <p>การใช้งาน Prajan (พระจันทร์) หมายถึงผู้ใช้ยอมรับข้อกำหนดนี้</p>
      <h2>ลักษณะบริการ</h2>
      <p>Prajan เป็น chatbot สำหรับให้ข้อมูลสินค้า/บริการ คอนเทนต์ความรู้ การรับข้อมูลผู้สนใจ และการส่งต่อให้เจ้าหน้าที่</p>
      <h2>ข้อจำกัด</h2>
      <p>คำตอบจากระบบเป็นข้อมูลทั่วไป ผู้ใช้ควรตรวจสอบรายละเอียดสำคัญกับเจ้าหน้าที่ก่อนตัดสินใจซื้อหรือดำเนินการใด ๆ</p>
      <h2>การใช้งานที่ไม่เหมาะสม</h2>
      <p>ห้ามใช้ระบบเพื่อส่งข้อความผิดกฎหมาย หลอกลวง คุกคาม ละเมิดสิทธิ หรือรบกวนการทำงานของบริการ</p>
      <h2>การเปลี่ยนแปลงบริการ</h2>
      <p>Prajan อาจปรับปรุงเนื้อหา ฟีเจอร์ หรือข้อกำหนดได้ตามความเหมาะสม โดยจะประกาศฉบับล่าสุดไว้ที่หน้านี้</p>
    `
  );
}

function documentPage(title, heading, body) {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #130d1d; color: #fffaf2; line-height: 1.75; }
    main { max-width: 760px; margin: 0 auto; padding: 48px 20px 64px; }
    h1 { font-size: clamp(28px, 5vw, 44px); margin: 0 0 24px; }
    h2 { font-size: 20px; margin-top: 32px; color: #d8c8ff; }
    p { margin: 12px 0; }
    .brand { color: #a997ff; font-weight: 700; margin-bottom: 12px; }
    .muted { color: #b8adc8; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <div class="brand">Prajan (พระจันทร์)</div>
    <h1>${escapeHtml(heading)}</h1>
    ${body}
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
