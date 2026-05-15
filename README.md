# Prajan LINE OA Chatbot

LINE OA: `Prajan` / `@052tqjbs`  
Concept: `ขอพรจากพระจันทร์`

This project provides the missing service URLs and a working chatbot backend:

- Privacy Policy: `/privacy`
- Terms of Service: `/terms`
- LINE Webhook: `/webhook`
- Admin dashboard: `/admin.html`

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with values from LINE Developers and your MariaDB instance. Do not commit real channel secrets, access tokens, or OpenAI keys.

Create database tables:

```bash
mysql -u root -p < sql/schema.sql
```

Run locally:

```bash
npm run dev
```

Open:

```text
http://localhost:3000/admin.html
```

Use `ADMIN_TOKEN` from `.env` in the admin page.

## LINE Developers URLs

After deploying to a public HTTPS domain, set:

```text
Privacy policy URL: https://your-domain.example/privacy
Terms of use URL: https://your-domain.example/terms
Webhook URL: https://your-domain.example/webhook
```

For local testing, expose the server with a tunnel and set `PUBLIC_BASE_URL` to that HTTPS URL.

## Supported Chatbot Flow

- `follow` event sends the Prajan welcome message.
- Text message can match content by `code`, `keyword`, or related title text.
- Audio messages are downloaded from LINE and sent to OpenAI transcription if `OPENAI_API_KEY` is set.
- `ขอพร`, `สนใจ`, or `ติดต่อกลับ` starts a lead collection flow.
- `ติดต่อเจ้าหน้าที่` starts a human-support lead flow.
- `สินค้า` or `บริการ` returns the `SERVICES` Flex Message.
- `สุ่มพร` or `พรประจำวัน` returns a daily blessing-style engagement message.

## OpenAI Transcription

The default transcription model is `gpt-4o-mini-transcribe`. OpenAI's current speech-to-text docs list `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, and `whisper-1` as compatible with `/v1/audio/transcriptions`; change `OPENAI_TRANSCRIBE_MODEL` if you prefer another model.

## Rich Menu

Create the Rich Menu in LINE Official Account Manager with 3 tappable zones:

1. `ดูคลิปที่น่าสนใจ` sends a keyword/code such as `AI01`.
2. `สินค้าและบริการ` sends `SERVICES`.
3. `ติดต่อเจ้าหน้าที่` sends `ติดต่อเจ้าหน้าที่`.

Use a moon visual with clear zones, but keep the action payloads text-based so the webhook can route them reliably.
