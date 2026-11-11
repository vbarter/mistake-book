-- 上壹课 MySQL 8 数据库结构（与 server/app/models.py 一一对应）
-- 用法：mysql -h 127.0.0.1 -P 3306 -u root -p < server/db/schema.mysql.sql

CREATE DATABASE IF NOT EXISTS zhicuoben
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
USE zhicuoben;

-- 用户：仅昵称、年级、学科设置与提醒偏好，不存姓名 / 学校 / 班级
CREATE TABLE IF NOT EXISTS users (
  id                VARCHAR(32)  NOT NULL COMMENT 'UUID hex',
  phone             VARCHAR(32)  NULL     COMMENT '手机号，验证码登录',
  password_hash     VARCHAR(255) NULL     COMMENT '登录密码哈希（手机号注册时设置）',
  apple_sub         VARCHAR(128) NULL     COMMENT 'Apple 登录的 sub',
  wx_openid         VARCHAR(64)  NULL     COMMENT '微信小程序 openid',
  apple_name        VARCHAR(64)  NULL     COMMENT 'Apple 首次授权给的姓名',
  apple_email       VARCHAR(128) NULL     COMMENT 'Apple identityToken 里的邮箱',
  nickname          VARCHAR(32)  NOT NULL DEFAULT '小同学',
  grade             VARCHAR(4)   NOT NULL DEFAULT '' COMMENT '年级 1-12；空 = 用户没设过',
  subjects          JSON         NULL     COMMENT '开启的学科数组，如 ["math","chinese"]',
  weekly_goal       INT          NOT NULL DEFAULT 5  COMMENT '每周复习目标 5/10/20',
  reminder_enabled  TINYINT(1)   NOT NULL DEFAULT 0,
  reminder_hour     INT          NOT NULL DEFAULT 19,
  reminder_minute   INT          NOT NULL DEFAULT 30,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active_at    DATETIME     NULL     COMMENT '最近一次打开 / 使用（管理后台统计）',
  last_platform     VARCHAR(12)  NULL     COMMENT '最近用的端：ios / android / wechat / web',
  PRIMARY KEY (id),
  KEY ix_users_last_active_at (last_active_at),
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
  topic_id          VARCHAR(24)  NULL     COMMENT '知识图谱知识点 id（server/app/data/taxonomy.json）',
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
  KEY ix_mistakes_topic_id (topic_id),
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

-- 导出任务（错题本 / 电子试卷 PDF 后台生成，文件在 UPLOAD_DIR/exports/，保留 7 天）
CREATE TABLE IF NOT EXISTS export_jobs (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  kind VARCHAR(8) DEFAULT 'book',
  title VARCHAR(120) DEFAULT '',
  detail VARCHAR(160) DEFAULT '',
  status VARCHAR(16) DEFAULT 'queued',
  error TEXT,
  pages INT DEFAULT 0,
  size INT DEFAULT 0,
  created_at DATETIME,
  updated_at DATETIME,
  INDEX idx_exports_user (user_id),
  INDEX idx_exports_status (status),
  INDEX idx_exports_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 擦除手写任务（后台逐张擦，擦好的照片在 UPLOAD_DIR/erase/<id>/，保留一天）
CREATE TABLE IF NOT EXISTS erase_jobs (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  status VARCHAR(16) DEFAULT 'queued',
  total_pages INT DEFAULT 0,
  done_pages INT DEFAULT 0,
  pages_state JSON NULL,
  error TEXT,
  created_at DATETIME,
  updated_at DATETIME,
  INDEX idx_erase_user (user_id),
  INDEX idx_erase_status (status),
  INDEX idx_erase_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 使用记录（管理后台统计用：打开、注册、登录、扫描、导出），不存试卷内容
CREATE TABLE IF NOT EXISTS usage_events (
  id         BIGINT      NOT NULL AUTO_INCREMENT,
  user_id    VARCHAR(32) NOT NULL,
  kind       VARCHAR(16) NOT NULL COMMENT 'open | signup | login | scan | scan_done | scan_fail | grade | pdf | book',
  platform   VARCHAR(12) NULL     COMMENT 'ios | android | wechat | web',
  method     VARCHAR(12) NULL     COMMENT '注册 / 登录方式',
  pages      INT         NOT NULL DEFAULT 0,
  questions  INT         NOT NULL DEFAULT 0,
  wrong      INT         NOT NULL DEFAULT 0,
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_usage_events_user_id (user_id),
  KEY ix_usage_events_kind (kind),
  KEY ix_usage_events_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='使用记录';

CREATE TABLE IF NOT EXISTS user_avatars (
  user_id    VARCHAR(32) NOT NULL,
  version    VARCHAR(16) NOT NULL COMMENT '当前头像的版本号，图片在对象存储 u/<user_id>/avatar-<version>.jpg',
  updated_at DATETIME    NULL,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户头像';

-- 已有库升级：微信小程序登录（用 root 执行）
-- ALTER TABLE users ADD COLUMN wx_openid VARCHAR(64) NULL COMMENT '微信小程序 openid' AFTER apple_sub, ADD UNIQUE KEY uk_users_wx_openid (wx_openid);
-- 已有库升级：手机号注册的登录密码（用 root 执行）
-- ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL COMMENT '登录密码哈希' AFTER phone;
-- 已有库升级：管理后台的活跃统计（用 root 执行；usage_events 用上面的 CREATE TABLE）
-- ALTER TABLE users ADD COLUMN last_active_at DATETIME NULL COMMENT '最近一次打开 / 使用' AFTER created_at, ADD COLUMN last_platform VARCHAR(12) NULL COMMENT '最近用的端' AFTER last_active_at, ADD KEY ix_users_last_active_at (last_active_at);
-- 已有库升级：管理后台按账号认人（用 root 执行）
-- ALTER TABLE users ADD COLUMN apple_name VARCHAR(64) NULL COMMENT 'Apple 首次授权给的姓名' AFTER wx_openid, ADD COLUMN apple_email VARCHAR(128) NULL COMMENT 'Apple identityToken 里的邮箱' AFTER apple_name;
-- ALTER TABLE mistakes ADD COLUMN topic_id VARCHAR(24) NULL COMMENT '知识图谱知识点 id' AFTER knowledge_points, ADD KEY ix_mistakes_topic_id (topic_id);

-- 云同步：文件夹 → 试卷 → 照片（id 是客户端生成的；时间字段是客户端 ISO 字符串；rev 是账号内递增的版本号；deleted 是删除标记）
CREATE TABLE IF NOT EXISTS sync_state (
  user_id VARCHAR(32) NOT NULL,
  rev     BIGINT      NOT NULL DEFAULT 0 COMMENT '这个账号的同步版本号，每写一条同步记录 +1',
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='云同步：账号版本号';

CREATE TABLE IF NOT EXISTS sync_folders (
  id                VARCHAR(32)  NOT NULL,
  user_id           VARCHAR(32)  NOT NULL,
  name              VARCHAR(120) NULL,
  subject           VARCHAR(16)  NULL,
  sort_order        INT          NULL,
  created_at        VARCHAR(32)  NULL,
  updated_at        VARCHAR(32)  NULL,
  rev               BIGINT       NOT NULL DEFAULT 0,
  deleted           TINYINT(1)   NOT NULL DEFAULT 0,
  server_updated_at DATETIME     NULL,
  PRIMARY KEY (id),
  KEY ix_sync_folders_user_id (user_id),
  KEY ix_sync_folders_user_rev (user_id, rev),
  KEY ix_sync_folders_server_updated_at (server_updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='云同步：文件夹';

CREATE TABLE IF NOT EXISTS sync_papers (
  id                VARCHAR(32)  NOT NULL,
  user_id           VARCHAR(32)  NOT NULL,
  folder_id         VARCHAR(32)  NOT NULL,
  name              VARCHAR(120) NULL,
  subject           VARCHAR(16)  NULL,
  subject_manual    TINYINT(1)   NULL,
  position          INT          NULL,
  meta              JSON         NULL     COMMENT 'scannedAt / gradedAt / taggedAt / printedAt / duplicateOf / notDuplicateOf / keepDuplicate',
  digitized         LONGTEXT     NULL     COMMENT '电子版 JSON',
  digitized_hash    VARCHAR(16)  NULL,
  created_at        VARCHAR(32)  NULL,
  updated_at        VARCHAR(32)  NULL,
  rev               BIGINT       NOT NULL DEFAULT 0,
  deleted           TINYINT(1)   NOT NULL DEFAULT 0,
  server_updated_at DATETIME     NULL,
  PRIMARY KEY (id),
  KEY ix_sync_papers_user_id (user_id),
  KEY ix_sync_papers_folder_id (folder_id),
  KEY ix_sync_papers_user_rev (user_id, rev),
  KEY ix_sync_papers_server_updated_at (server_updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='云同步：试卷';

CREATE TABLE IF NOT EXISTS sync_pages (
  id                VARCHAR(32)  NOT NULL,
  user_id           VARCHAR(32)  NOT NULL,
  owner_id          VARCHAR(32)  NOT NULL COMMENT '照片文件在对象存储里所在的用户目录',
  paper_id          VARCHAR(32)  NOT NULL,
  position          INT          NULL,
  width             INT          NULL,
  height            INT          NULL,
  sha               VARCHAR(32)  NULL,
  dhash             VARCHAR(32)  NULL,
  erased_at         VARCHAR(32)  NULL,
  has_original      TINYINT(1)   NULL,
  has_erased        VARCHAR(32)  NULL,
  has_thumb         TINYINT(1)   NULL,
  bytes             BIGINT       NULL,
  created_at        VARCHAR(32)  NULL,
  updated_at        VARCHAR(32)  NULL,
  rev               BIGINT       NOT NULL DEFAULT 0,
  deleted           TINYINT(1)   NOT NULL DEFAULT 0,
  server_updated_at DATETIME     NULL,
  PRIMARY KEY (id),
  KEY ix_sync_pages_user_id (user_id),
  KEY ix_sync_pages_paper_id (paper_id),
  KEY ix_sync_pages_user_rev (user_id, rev),
  KEY ix_sync_pages_server_updated_at (server_updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='云同步：试卷照片';


-- ---------------------------------------------------------------- 学习计划（老师布置作业）

CREATE TABLE IF NOT EXISTS plans (
  id          VARCHAR(32) NOT NULL,
  owner_id    VARCHAR(32) NOT NULL COMMENT '创建人（老师）',
  name        VARCHAR(60) NULL,
  subject     VARCHAR(16) NULL COMMENT '学科，或 mixed（综合）',
  invite_code VARCHAR(16) NOT NULL COMMENT '转发出去的卡片 / 链接里带的码',
  created_at  DATETIME    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY ix_plans_invite_code (invite_code),
  KEY ix_plans_owner_id (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学习计划';

CREATE TABLE IF NOT EXISTS plan_members (
  id        VARCHAR(32) NOT NULL,
  plan_id   VARCHAR(32) NOT NULL,
  user_id   VARCHAR(32) NOT NULL,
  joined_at DATETIME    NULL,
  removed   TINYINT(1)  NOT NULL DEFAULT 0 COMMENT '退出或被移除',
  PRIMARY KEY (id),
  UNIQUE KEY uq_plan_members (plan_id, user_id),
  KEY ix_plan_members_plan_id (plan_id),
  KEY ix_plan_members_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学习计划：成员（名字不存，显示时取账号称呼）';

CREATE TABLE IF NOT EXISTS plan_assignments (
  id             VARCHAR(32)  NOT NULL,
  plan_id        VARCHAR(32)  NOT NULL,
  title          VARCHAR(120) NULL,
  due_at         VARCHAR(32)  NULL COMMENT '截止时间（客户端给的 ISO 时间）',
  digitized      LONGTEXT     NULL COMMENT '扫描件识别出的电子版',
  question_count INT          NULL,
  revoked        TINYINT(1)   NOT NULL DEFAULT 0,
  created_at     DATETIME     NULL,
  PRIMARY KEY (id),
  KEY ix_plan_assignments_plan_id (plan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学习计划：作业';

CREATE TABLE IF NOT EXISTS plan_files (
  id            VARCHAR(32)  NOT NULL,
  plan_id       VARCHAR(32)  NOT NULL,
  assignment_id VARCHAR(32)  NOT NULL,
  submission_id VARCHAR(32)  NULL COMMENT '空 = 作业内容；非空 = 这次提交的照片',
  kind          VARCHAR(12)  NULL COMMENT 'scan | attachment',
  name          VARCHAR(120) NULL,
  mime          VARCHAR(80)  NULL,
  ext           VARCHAR(8)   NULL,
  size          BIGINT       NULL,
  position      INT          NULL,
  uploaded      TINYINT(1)   NOT NULL DEFAULT 0,
  created_at    DATETIME     NULL,
  PRIMARY KEY (id),
  KEY ix_plan_files_plan_id (plan_id),
  KEY ix_plan_files_assignment_id (assignment_id),
  KEY ix_plan_files_submission_id (submission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学习计划：文件（本体在对象存储 plans/<planId>/<id>.<ext>）';

CREATE TABLE IF NOT EXISTS plan_submissions (
  id            VARCHAR(32)  NOT NULL,
  plan_id       VARCHAR(32)  NOT NULL,
  assignment_id VARCHAR(32)  NOT NULL,
  user_id       VARCHAR(32)  NOT NULL,
  status        VARCHAR(12)  NULL COMMENT 'submitted | reviewed | returned',
  comment       VARCHAR(200) NULL,
  late          TINYINT(1)   NULL,
  results       JSON         NULL COMMENT '逐题结果',
  submitted_at  DATETIME     NULL,
  reviewed_at   DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_plan_submissions (assignment_id, user_id),
  KEY ix_plan_submissions_plan_id (plan_id),
  KEY ix_plan_submissions_assignment_id (assignment_id),
  KEY ix_plan_submissions_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学习计划：学生的提交';

CREATE TABLE IF NOT EXISTS plan_views (
  id            INT         NOT NULL AUTO_INCREMENT,
  assignment_id VARCHAR(32) NOT NULL,
  user_id       VARCHAR(32) NOT NULL,
  viewed_at     DATETIME    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_plan_views (assignment_id, user_id),
  KEY ix_plan_views_assignment_id (assignment_id),
  KEY ix_plan_views_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学习计划：成员打开过哪份作业';

CREATE TABLE IF NOT EXISTS plan_tombstones (
  ref          VARCHAR(32) NOT NULL,
  plan_id      VARCHAR(32) NOT NULL,
  dissolved_at DATETIME    NULL,
  PRIMARY KEY (ref),
  KEY ix_plan_tombstones_plan_id (plan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学习计划：解散后留的记号（计划 id / 邀请码 / 作业 id），再有人点进来时说清已解散';
