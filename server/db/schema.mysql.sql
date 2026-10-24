-- 知错本 MySQL 8 数据库结构（与 server/app/models.py 一一对应）
-- 用法：mysql -h 127.0.0.1 -P 3306 -u root -p < server/db/schema.mysql.sql

CREATE DATABASE IF NOT EXISTS zhicuoben
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
USE zhicuoben;

-- 用户：仅昵称、年级、学科设置与提醒偏好，不存姓名 / 学校 / 班级
CREATE TABLE IF NOT EXISTS users (
  id                VARCHAR(32)  NOT NULL COMMENT 'UUID hex',
  phone             VARCHAR(32)  NULL     COMMENT '手机号，验证码登录',
  apple_sub         VARCHAR(128) NULL     COMMENT 'Apple 登录的 sub',
  wx_openid         VARCHAR(64)  NULL     COMMENT '微信小程序 openid',
  nickname          VARCHAR(32)  NOT NULL DEFAULT '小同学',
  grade             VARCHAR(4)   NOT NULL DEFAULT '5' COMMENT '年级 3-6',
  subjects          JSON         NULL     COMMENT '开启的学科数组，如 ["math","chinese"]',
  weekly_goal       INT          NOT NULL DEFAULT 5  COMMENT '每周复习目标 5/10/20',
  reminder_enabled  TINYINT(1)   NOT NULL DEFAULT 0,
  reminder_hour     INT          NOT NULL DEFAULT 19,
  reminder_minute   INT          NOT NULL DEFAULT 30,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_phone (phone),
  UNIQUE KEY uk_users_apple_sub (apple_sub),
  UNIQUE KEY uk_users_wx_openid (wx_openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户';

-- 错题
CREATE TABLE IF NOT EXISTS mistakes (
  id                VARCHAR(32)  NOT NULL,
  user_id           VARCHAR(32)  NOT NULL,
  subject           VARCHAR(16)  NOT NULL COMMENT 'math / chinese / english / science',
  knowledge_points  JSON         NULL     COMMENT '知识点数组，1-3 个',
  question_type     VARCHAR(16)  NOT NULL DEFAULT 'solve' COMMENT 'choice / fill / solve',
  options           JSON         NULL     COMMENT '选择题选项数组',
  stem_text         TEXT         NULL     COMMENT '题干',
  stem_image        VARCHAR(256) NULL     COMMENT '原题截图相对路径 <user_id>/<uuid>.jpg',
  uncertain_spans   JSON         NULL     COMMENT 'OCR 不确定片段',
  student_answer    TEXT         NULL,
  correct_answer    TEXT         NULL,
  analysis          TEXT         NULL,
  tip               TEXT         NULL     COMMENT '下次注意',
  ai_generated      TINYINT(1)   NOT NULL DEFAULT 1,
  ai_pending        TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '离线录入，解析待补',
  reasons           JSON         NULL     COMMENT '错因数组 concept/misread/method/calculation/careless',
  note              TEXT         NULL,
  source            JSON         NULL     COMMENT '{name,page,box,date}',
  mastered          TINYINT(1)   NOT NULL DEFAULT 0,
  manual_mastered   TINYINT(1)   NOT NULL DEFAULT 0,
  mastered_at       DATETIME     NULL,
  interval_index    INT          NOT NULL DEFAULT 0 COMMENT '间隔档位 0-4 → 1/3/7/15/30 天',
  next_due_at       DATETIME     NULL     COMMENT '下次复习时间；<= now 即待复习',
  streak            INT          NOT NULL DEFAULT 0 COMMENT '连续记得次数',
  wrong_count       INT          NOT NULL DEFAULT 1,
  variants          JSON         NULL     COMMENT '同类变式题数组',
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_mistakes_user_id (user_id),
  KEY ix_mistakes_subject (subject),
  KEY ix_mistakes_mastered (mastered),
  KEY ix_mistakes_next_due_at (next_due_at),
  KEY ix_mistakes_created_at (created_at),
  KEY ix_mistakes_user_due (user_id, mastered, next_due_at),
  CONSTRAINT fk_mistakes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='错题';

-- 复习 / 练习 / 录入 / 掌握 事件流水
CREATE TABLE IF NOT EXISTS review_logs (
  id          VARCHAR(32) NOT NULL,
  user_id     VARCHAR(32) NOT NULL,
  mistake_id  VARCHAR(32) NOT NULL,
  kind        VARCHAR(16) NOT NULL DEFAULT 'review' COMMENT 'review / practice / create / master',
  result      VARCHAR(16) NOT NULL DEFAULT ''       COMMENT 'forgot / fuzzy / remembered / correct / wrong / new / again / manual / reinstated',
  created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_review_logs_user_id (user_id),
  KEY ix_review_logs_mistake_id (mistake_id),
  KEY ix_review_logs_created_at (created_at),
  KEY ix_review_logs_user_kind_time (user_id, kind, created_at),
  CONSTRAINT fk_review_logs_user    FOREIGN KEY (user_id)    REFERENCES users (id)    ON DELETE CASCADE,
  CONSTRAINT fk_review_logs_mistake FOREIGN KEY (mistake_id) REFERENCES mistakes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学习记录';

-- 练习会话
CREATE TABLE IF NOT EXISTS practice_sessions (
  id              VARCHAR(32) NOT NULL,
  user_id         VARCHAR(32) NOT NULL,
  mode            VARCHAR(16) NOT NULL DEFAULT 'weak' COMMENT 'weak / custom',
  topic           VARCHAR(64) NULL,
  subject         VARCHAR(16) NULL,
  items           JSON        NULL COMMENT '题目数组（含答案与解析）',
  answers         JSON        NULL COMMENT '{"0": {"answer": "A", "correct": true}}',
  mastery_before  JSON        NULL COMMENT '开始时各知识点掌握度，用于结果页对比',
  started_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at     DATETIME    NULL,
  PRIMARY KEY (id),
  KEY ix_practice_sessions_user_id (user_id),
  CONSTRAINT fk_practice_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='练习会话';

-- 应用账号（生产环境请改密码并限制来源）
CREATE USER IF NOT EXISTS 'zhicuoben'@'%' IDENTIFIED BY 'zhicuoben';
GRANT SELECT, INSERT, UPDATE, DELETE ON zhicuoben.* TO 'zhicuoben'@'%';
FLUSH PRIVILEGES;


-- 试卷数字化后台任务（结果保留一天，服务端按需清理）
CREATE TABLE IF NOT EXISTS digitize_jobs (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  status VARCHAR(16) DEFAULT 'queued',
  total_pages INT DEFAULT 0,
  done_pages INT DEFAULT 0,
  result JSON NULL,
  error TEXT,
  created_at DATETIME,
  updated_at DATETIME,
  INDEX idx_jobs_user (user_id),
  INDEX idx_jobs_status (status),
  INDEX idx_jobs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 已有库升级：微信小程序登录（用 root 执行）
-- ALTER TABLE users ADD COLUMN wx_openid VARCHAR(64) NULL COMMENT '微信小程序 openid' AFTER apple_sub, ADD UNIQUE KEY uk_users_wx_openid (wx_openid);
