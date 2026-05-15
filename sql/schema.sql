CREATE DATABASE IF NOT EXISTS prajan
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE prajan;

CREATE TABLE IF NOT EXISTS content_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL,
  keyword VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  summary TEXT NULL,
  body TEXT NOT NULL,
  media_url VARCHAR(1000) NULL,
  action_label VARCHAR(80) NULL,
  action_url VARCHAR(1000) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_content_code (code),
  KEY idx_content_keyword (keyword),
  KEY idx_content_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leads (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  line_user_id VARCHAR(128) NOT NULL,
  topic VARCHAR(128) NOT NULL DEFAULT 'general',
  full_name VARCHAR(255) NULL,
  phone VARCHAR(80) NULL,
  segment ENUM('newbie', 'loyal', 'vip', 'blocked') NOT NULL DEFAULT 'newbie',
  status ENUM('active', 'blocked', 'redirected') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lead_line_user (line_user_id),
  KEY idx_lead_segment (segment),
  KEY idx_lead_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_sessions (
  line_user_id VARCHAR(128) NOT NULL,
  topic VARCHAR(128) NOT NULL DEFAULT 'general',
  step VARCHAR(64) NOT NULL,
  full_name VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (line_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS interactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  line_user_id VARCHAR(128) NOT NULL,
  message_type VARCHAR(40) NOT NULL,
  message_text TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_interactions_user_created (line_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS broadcasts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  target_segment VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  status ENUM('draft', 'scheduled', 'sent', 'failed') NOT NULL DEFAULT 'draft',
  scheduled_at DATETIME NULL,
  sent_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_broadcast_status (status),
  KEY idx_broadcast_segment (target_segment)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO content_items (code, keyword, title, summary, body, action_label, action_url)
VALUES
  (
    'AI01',
    'สร้างคลิปด้วยAI',
    'สร้างคลิปด้วย AI',
    'Prompt + ขั้นตอนใช้งาน + ลิงก์คลิปตัวอย่าง',
    'พิมพ์โจทย์หรือไอเดียของคุณให้ชัด ระบุสินค้า กลุ่มเป้าหมาย โทนภาพ ความยาว และช่องทางที่จะลง แล้ว Prajan จะช่วยจัด prompt และแนวทางทำคลิปให้เป็นขั้นตอน',
    'ดูคลิปตัวอย่าง',
    'https://example.com/ai-video'
  ),
  (
    'SERVICES',
    'สินค้าและบริการ',
    'สินค้าและบริการของ Prajan',
    'Solution สำหรับคอนเทนต์ AI, chatbot และระบบดูแลลูกค้า',
    'Prajan ช่วยออกแบบ LINE OA chatbot, ระบบตอบกลับอัตโนมัติ, เก็บ lead, จัดกลุ่มลูกค้า และต่อยอด broadcast/retargeting ให้เหมาะกับธุรกิจ',
    'ติดต่อเจ้าหน้าที่',
    'https://line.me/R/ti/p/@052tqjbs'
  )
ON DUPLICATE KEY UPDATE
  keyword = VALUES(keyword),
  title = VALUES(title),
  summary = VALUES(summary),
  body = VALUES(body),
  action_label = VALUES(action_label),
  action_url = VALUES(action_url);
