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
- Text message can match content by `code`, `keyword`, title, summary, or body text.
- Audio messages are downloaded from LINE and sent to OpenAI transcription if `OPENAI_API_KEY` is set.
- `ขอพร`, `สนใจ`, or `ติดต่อกลับ` starts a lead collection flow.
- `ติดต่อเจ้าหน้าที่` starts a human-support lead flow.
- `สินค้า` or `บริการ` returns the `SERVICES` Flex Message.
- `สุ่มพร` or `พรประจำวัน` returns a daily blessing-style engagement message.

## Import Video Knowledge Base

The Google Sheet can be imported into `content_items` and reused by the LINE chatbot:

```bash
npm run import:kb -- --dry-run
npm run import:kb -- --fetch-titles
npm run import:kb -- --dry-run --fetch-titles --timeout 3000 --concurrency 20
npm run import:kb -- --csv data/knowledge-base-enriched.csv --dry-run
```

Default source:

- `AllVideo` (`gid=321854832`) imports as `VID001`, `VID002`, ...
- `AllShort` (`gid=2147112064`) imports as `SHORT001`, `SHORT002`, ...

The importer maps Sheet columns like this:

- `Video Title (ชื่อคลิป)` -> `title`
- `URL / Timestamp Link (ลิงก์วิดีโอ)` -> `action_url`
- `Summary & Key Content (เนื้อหาสรุป)` -> `summary` and `body`
- `Keywords / Tag` -> `keyword`

Run it again after editing the Sheet; existing rows are updated by `code`. If title cells are blank, `--fetch-titles` tries to read YouTube oEmbed titles. Chatbot answers become much better when each row has a real summary and topic tags such as `PDPA`, `Security`, `AI`, `Chatbot`, or `บริการ`.

To generate filled CSV files from YouTube metadata before importing:

```bash
npm run enrich:kb -- --timeout 10000 --concurrency 16
```

This writes:

- `data/AllVideo-enriched.csv`
- `data/AllShort-enriched.csv`
- `data/knowledge-base-enriched.csv`

## OpenAI Transcription

The default transcription model is `gpt-4o-mini-transcribe`. OpenAI's current speech-to-text docs list `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, and `whisper-1` as compatible with `/v1/audio/transcriptions`; change `OPENAI_TRANSCRIBE_MODEL` if you prefer another model.

## Rich Menu

Create the Rich Menu in LINE Official Account Manager with 3 tappable zones:

1. `ดูคลิปที่น่าสนใจ` sends a keyword/code such as `AI01`.
2. `สินค้าและบริการ` sends `SERVICES`.
3. `ติดต่อเจ้าหน้าที่` sends `ติดต่อเจ้าหน้าที่`.

Use a moon visual with clear zones, but keep the action payloads text-based so the webhook can route them reliably.
