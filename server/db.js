import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const dataDir = process.env.DATA_DIR || path.join(appRoot, "data");
export const uploadDir = path.join(dataDir, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, "review.db"));
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    page_count INTEGER NOT NULL DEFAULT 0,
    char_count INTEGER NOT NULL DEFAULT 0,
    start_page INTEGER,
    end_page INTEGER,
    status TEXT NOT NULL DEFAULT '待审读',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pages (
    book_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    text TEXT NOT NULL,
    spans_json TEXT NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    PRIMARY KEY (book_id, page_number),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS review_tasks (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    stage TEXT NOT NULL,
    error TEXT,
    source_snapshot TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS review_units (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT '待处理',
    result_json TEXT,
    error TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE (task_id, chunk_index),
    FOREIGN KEY (task_id) REFERENCES review_tasks(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    chapter TEXT NOT NULL DEFAULT '',
    quote TEXT NOT NULL,
    context TEXT NOT NULL,
    category TEXT NOT NULL,
    subcategory TEXT NOT NULL,
    finding_level TEXT NOT NULL,
    severity TEXT NOT NULL,
    explanation TEXT NOT NULL,
    suggestion TEXT NOT NULL,
    evidence TEXT NOT NULL DEFAULT '',
    source_name TEXT NOT NULL DEFAULT '',
    source_version TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    locations_json TEXT NOT NULL DEFAULT '[]',
    review_status TEXT NOT NULL DEFAULT '待判断',
    editor_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES review_tasks(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    domain TEXT NOT NULL,
    category TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    sync_status TEXT NOT NULL DEFAULT '未同步',
    last_synced_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS source_versions (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    version TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    published_at TEXT,
    fetched_at TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    url TEXT NOT NULL,
    is_current INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
  );
`);

const bookColumns = db.prepare("PRAGMA table_info(books)").all();
if (!bookColumns.some((column) => column.name === "user_id")) {
  db.exec("ALTER TABLE books ADD COLUMN user_id TEXT REFERENCES users(id)");
}
db.exec("CREATE INDEX IF NOT EXISTS books_user_id_idx ON books(user_id)");

const findingColumns = db.prepare("PRAGMA table_info(findings)").all();
if (!findingColumns.some((column) => column.name === "editor_suggestion")) {
  db.exec("ALTER TABLE findings ADD COLUMN editor_suggestion TEXT NOT NULL DEFAULT ''");
}

const subcategoryMigrations = [
  ["图书内容导向", "法律法规对图书内容导向的规定"],
  ["法律法规或文件摘录、引用", "涉及法律法规或文件摘录、引用的差错"],
  ["国土统一、主权和领土完整", "涉及国土统一、主权和领土完整的差错"],
  ["党政机构名称及党和国家领导人职务、姓名", "涉及党政机构名称、党和国家领导人职务及姓名的差错"],
  ["民族和宗教问题", "涉及民族问题和宗教问题的差错"],
  ["国家秘密风险", "涉及国家秘密的差错"],
  ["未成年人教育", "涉及未成年人教育的差错"],
  ["台湾地区机构称谓", "涉及台湾地区机构称谓的差错"],
  ["国际关系", "涉及国际关系的差错"],
  ["标号差错", "标点差错"],
  ["中文出版物夹用英文标点差错", "中文出版物夹用英文的标点差错"]
];
for (const [oldName, newName] of subcategoryMigrations) {
  db.prepare("UPDATE findings SET subcategory = ? WHERE subcategory = ?").run(newName, oldName);
}
db.prepare("UPDATE findings SET review_status = '已忽略' WHERE review_status = '已驳回'").run();

export function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

export function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

export function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}
