import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { PDFDocument, rgb } from "pdf-lib";
import { all, appRoot, db, get, run, uploadDir } from "./db.js";
import { extractPdf, prepareReviewPages } from "./pdf.js";
import { cancelReview, locateQuote, markTableOfContentsPages, runReview } from "./reviewer.js";
import { currentSources, syncSource } from "./sources.js";
import { FINDING_LEVELS, REVIEW_STATUSES, SEVERITIES, TAXONOMY } from "./taxonomy.js";
import { createConfirmedWord } from "./word.js";

const app = express();
const port = Number(process.env.PORT || 8787);
const upload = multer({ dest: uploadDir, limits: { fileSize: 200 * 1024 * 1024 } });
app.use(express.json({ limit: "2mb" }));

function now() { return new Date().toISOString(); }
function decodeUploadName(name) {
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return decoded.includes("�") ? name : decoded;
}

function sessionToken(req) {
  return String(req.headers.cookie || "").split(";").map((item) => item.trim()).find((item) => item.startsWith("session="))?.slice(8) || "";
}

function requireUser(req, res, next) {
  const session = get("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?", [sessionToken(req)]);
  if (!session) return res.status(401).json({ error: "请先登录" });
  req.user = session;
  next();
}

function bookForUser(id, userId) {
  return get("SELECT * FROM books WHERE id = ? AND user_id = ?", [id, userId]);
}

function findingPosition(item) {
  const locations = JSON.parse(item.locations_json || "[]");
  const first = locations.reduce((current, location) => {
    if (!current || location.page < current.page || (location.page === current.page && (location.y < current.y || (location.y === current.y && location.x < current.x)))) return location;
    return current;
  }, null);
  return [item.page_number, first?.y ?? Number.MAX_SAFE_INTEGER, first?.x ?? Number.MAX_SAFE_INTEGER];
}

function sortFindings(items) {
  return items.sort((a, b) => {
    const left = findingPosition(a);
    const right = findingPosition(b);
    return left[0] - right[0] || left[1] - right[1] || left[2] - right[2] || a.quote.localeCompare(b.quote, "zh-CN");
  });
}

function refreshFindingLocations(bookId, taskId) {
  const pages = new Map(all("SELECT * FROM pages WHERE book_id = ?", [bookId]).map((page) => [page.page_number, page]));
  for (const finding of all("SELECT id, page_number, quote, locations_json FROM findings WHERE task_id = ?", [taskId])) {
    const page = pages.get(finding.page_number);
    if (!page) continue;
    const locations = locateQuote(page, finding.quote);
    const locationsJson = JSON.stringify(locations);
    if (locationsJson !== finding.locations_json) run("UPDATE findings SET locations_json = ? WHERE id = ?", [locationsJson, finding.id]);
  }
}

function migrateReviewText() {
  for (const book of all("SELECT id FROM books")) {
    const storedPages = all("SELECT * FROM pages WHERE book_id = ? ORDER BY page_number", [book.id]);
    const filteredPages = prepareReviewPages(storedPages.map((page) => ({
      pageNumber: page.page_number,
      text: page.text,
      spans: JSON.parse(page.spans_json),
      width: page.width,
      height: page.height
    })));
    const changedPages = new Set();
    for (const page of filteredPages) {
      const stored = storedPages[page.pageNumber - 1];
      const spansJson = JSON.stringify(page.spans);
      if (page.text === stored.text && spansJson === stored.spans_json) continue;
      run("UPDATE pages SET text = ?, spans_json = ? WHERE book_id = ? AND page_number = ?", [page.text, spansJson, book.id, page.pageNumber]);
      changedPages.add(page.pageNumber);
    }
    if (!changedPages.size) continue;
    const pages = new Map(all("SELECT * FROM pages WHERE book_id = ?", [book.id]).map((page) => [page.page_number, page]));
    for (const finding of all("SELECT id, page_number, quote, subcategory, suggestion FROM findings WHERE book_id = ?", [book.id])) {
      const page = pages.get(finding.page_number);
      const normalizedText = page.text.replace(/\s+/g, "");
      const normalizedQuote = finding.quote.replace(/\s+/g, "");
      const isLeaderDots = finding.subcategory === "点号差错" && /\.{8,}/.test(finding.quote);
      const isWhitespaceOnly = finding.subcategory === "多字、漏字、倒字" && finding.suggestion.replace(/\s+/g, "") === normalizedQuote;
      if (isLeaderDots || isWhitespaceOnly || !normalizedText.includes(normalizedQuote)) {
        run("DELETE FROM findings WHERE id = ?", [finding.id]);
      } else if (changedPages.has(finding.page_number)) {
        run("UPDATE findings SET locations_json = ? WHERE id = ?", [JSON.stringify(locateQuote(page, finding.quote)), finding.id]);
      }
    }
  }
}

function removeDirectoryLayoutFindings() {
  for (const book of all("SELECT id FROM books")) {
    const pages = markTableOfContentsPages(all("SELECT * FROM pages WHERE book_id = ? ORDER BY page_number", [book.id]));
    const directoryPages = pages.filter((page) => page.is_table_of_contents).map((page) => page.page_number);
    if (!directoryPages.length) continue;
    const placeholders = directoryPages.map(() => "?").join(",");
    run(`DELETE FROM findings WHERE book_id = ? AND page_number IN (${placeholders}) AND subcategory NOT IN ('错别字', '不规范字')`, [book.id, ...directoryPages]);
  }
}

app.post("/api/auth/login", (req, res) => {
  const phone = String(req.body.phone || "").trim();
  const code = String(req.body.code || "").trim();
  if (!/^1\d{10}$/.test(phone)) return res.status(400).json({ error: "请输入正确的手机号" });
  if (code !== phone.slice(-6)) return res.status(400).json({ error: "验证码错误" });
  let user = get("SELECT * FROM users WHERE phone = ?", [phone]);
  if (!user) {
    const userId = crypto.randomUUID();
    run("INSERT INTO users (id, phone, created_at) VALUES (?, ?, ?)", [userId, phone, now()]);
    user = get("SELECT * FROM users WHERE id = ?", [userId]);
    if (Number(get("SELECT COUNT(*) AS count FROM users").count) === 1) run("UPDATE books SET user_id = ? WHERE user_id IS NULL", [userId]);
  }
  const token = crypto.randomBytes(32).toString("hex");
  run("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)", [token, user.id, now()]);
  res.setHeader("Set-Cookie", `session=${token}; HttpOnly; SameSite=Strict; Path=/`);
  res.json({ id: user.id, phone: user.phone });
});

app.get("/api/auth/me", requireUser, (req, res) => res.json({ id: req.user.id, phone: req.user.phone }));

app.post("/api/auth/logout", requireUser, (req, res) => {
  run("DELETE FROM sessions WHERE token = ?", [sessionToken(req)]);
  res.setHeader("Set-Cookie", "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api", requireUser);

app.get("/api/meta", (_req, res) => res.json({ taxonomy: TAXONOMY, findingLevels: FINDING_LEVELS, severities: SEVERITIES, reviewStatuses: REVIEW_STATUSES, modelEnabled: Boolean(process.env.LLM_API_KEY || process.env.OPENAI_API_KEY) }));

app.get("/api/books", (req, res) => {
  const books = all(`SELECT b.*, (SELECT COUNT(*) FROM findings f WHERE f.book_id = b.id) AS finding_count,
    (SELECT COUNT(*) FROM findings f WHERE f.book_id = b.id AND f.review_status = '已确认') AS confirmed_count
    FROM books b WHERE b.user_id = ? ORDER BY b.created_at DESC`, [req.user.id]);
  res.json(books);
});

async function createBook(file, userId, customTitle = "") {
    if (file.mimetype !== "application/pdf") throw new Error("请上传PDF文件");
    const id = crypto.randomUUID();
    const finalName = `${id}.pdf`;
    const finalPath = path.join(uploadDir, finalName);
    fs.renameSync(file.path, finalPath);
    const pages = await extractPdf(fs.readFileSync(finalPath));
    const charCount = pages.reduce((sum, page) => sum + page.text.length, 0);
    const originalName = decodeUploadName(file.originalname);
    const title = String(customTitle || path.basename(originalName, path.extname(originalName))).trim();
    db.exec("BEGIN");
    try {
      run(`INSERT INTO books (id, title, filename, file_path, page_count, char_count, start_page, end_page, created_at, updated_at, user_id)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`, [id, title, originalName, finalName, pages.length, charCount, pages.length, now(), now(), userId]);
      for (const page of pages) {
        run("INSERT INTO pages (book_id, page_number, text, spans_json, width, height) VALUES (?, ?, ?, ?, ?, ?)", [id, page.pageNumber, page.text, JSON.stringify(page.spans), page.width, page.height]);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { id, pageCount: pages.length };
}

function startBookReview(bookId, pageCount) {
  const taskId = crypto.randomUUID();
  const snapshot = currentSources().map((source) => source.id);
  run("UPDATE books SET status = '排队中', updated_at = ? WHERE id = ?", [now(), bookId]);
  run("INSERT INTO review_tasks (id, book_id, status, progress, stage, source_snapshot, created_at) VALUES (?, ?, '排队中', 0, '等待处理', ?, ?)", [taskId, bookId, JSON.stringify(snapshot), now()]);
  setImmediate(() => runReview(taskId));
}

app.post("/api/books", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) throw new Error("请上传PDF文件");
    const book = await createBook(req.file, req.user.id, req.body.title);
    res.status(201).json({ id: book.id });
  } catch (error) { next(error); }
});

app.post("/api/books/batch", upload.array("files"), async (req, res, next) => {
  try {
    if (!req.files?.length) throw new Error("请选择PDF文件");
    const books = [];
    for (const file of req.files) books.push(await createBook(file, req.user.id));
    for (const book of books) startBookReview(book.id, book.pageCount);
    res.status(201).json({ ids: books.map((book) => book.id) });
  } catch (error) { next(error); }
});

app.get("/api/books/:id", (req, res) => {
  const book = bookForUser(req.params.id, req.user.id);
  if (!book) return res.status(404).json({ error: "书稿不存在" });
  const task = get("SELECT * FROM review_tasks WHERE book_id = ? ORDER BY created_at DESC LIMIT 1", [book.id]);
  const findings = task
    ? sortFindings(all("SELECT * FROM findings WHERE task_id = ?", [task.id])).map((item) => ({ ...item, locations: JSON.parse(item.locations_json) }))
    : [];
  res.json({ ...book, pdf_url: `/api/books/${book.id}/file`, task, findings });
});

app.get("/api/books/:id/file", (req, res) => {
  const book = bookForUser(req.params.id, req.user.id);
  if (!book) return res.status(404).json({ error: "书稿不存在" });
  res.sendFile(path.join(uploadDir, book.file_path));
});

app.get("/api/books/:id/pages/:page", (req, res) => {
  const book = bookForUser(req.params.id, req.user.id);
  if (!book) return res.status(404).json({ error: "书稿不存在" });
  const page = get("SELECT page_number, text, width, height FROM pages WHERE book_id = ? AND page_number = ?", [book.id, Number(req.params.page)]);
  if (!page) return res.status(404).json({ error: "页面不存在" });
  res.json(page);
});

app.post("/api/books/:id/review", (req, res) => {
  const book = bookForUser(req.params.id, req.user.id);
  if (!book) return res.status(404).json({ error: "书稿不存在" });
  const startPage = Math.max(1, Number(req.body.start_page || 1));
  const endPage = Math.min(book.page_count, Number(req.body.end_page || book.page_count));
  if (startPage > endPage) return res.status(400).json({ error: "正文页范围无效" });
  const failedTask = get("SELECT * FROM review_tasks WHERE book_id = ? AND status = '失败' ORDER BY created_at DESC LIMIT 1", [book.id]);
  if (failedTask && book.start_page === startPage && book.end_page === endPage) {
    run("UPDATE review_tasks SET status = '排队中', stage = '等待重试', error = NULL WHERE id = ?", [failedTask.id]);
    run("UPDATE books SET status = '排队中', updated_at = ? WHERE id = ?", [now(), book.id]);
    setImmediate(() => runReview(failedTask.id));
    return res.status(202).json({ task_id: failedTask.id });
  }
  const taskId = crypto.randomUUID();
  const snapshot = currentSources().map((source) => source.id);
  run("UPDATE books SET start_page = ?, end_page = ?, status = '排队中', updated_at = ? WHERE id = ?", [startPage, endPage, now(), book.id]);
  run("INSERT INTO review_tasks (id, book_id, status, progress, stage, source_snapshot, created_at) VALUES (?, ?, '排队中', 0, '等待处理', ?, ?)", [taskId, book.id, JSON.stringify(snapshot), now()]);
  setImmediate(() => runReview(taskId));
  res.status(202).json({ task_id: taskId });
});

app.delete("/api/books/:id", (req, res) => {
  const book = bookForUser(req.params.id, req.user.id);
  if (!book) return res.status(404).json({ error: "书稿不存在" });
  for (const task of all("SELECT id FROM review_tasks WHERE book_id = ?", [book.id])) cancelReview(task.id);
  fs.unlinkSync(path.join(uploadDir, book.file_path));
  run("DELETE FROM books WHERE id = ?", [book.id]);
  res.json({ ok: true });
});

app.patch("/api/findings/:id", (req, res) => {
  const finding = get("SELECT f.* FROM findings f JOIN books b ON b.id = f.book_id WHERE f.id = ? AND b.user_id = ?", [req.params.id, req.user.id]);
  if (!finding) return res.status(404).json({ error: "问题不存在" });
  const status = REVIEW_STATUSES.includes(req.body.review_status) ? req.body.review_status : finding.review_status;
  const note = req.body.editor_note === undefined ? finding.editor_note : String(req.body.editor_note);
  const editorSuggestion = req.body.editor_suggestion === undefined ? finding.editor_suggestion : String(req.body.editor_suggestion).trim();
  run("UPDATE findings SET review_status = ?, editor_note = ?, editor_suggestion = ? WHERE id = ?", [status, note, editorSuggestion, finding.id]);
  res.json({ ok: true });
});

app.get("/api/books/:id/annotated-pdf", async (req, res, next) => {
  try {
    const book = bookForUser(req.params.id, req.user.id);
    if (!book) return res.status(404).json({ error: "书稿不存在" });
    const task = get("SELECT id FROM review_tasks WHERE book_id = ? ORDER BY created_at DESC LIMIT 1", [book.id]);
    if (task) refreshFindingLocations(book.id, task.id);
    const findings = task ? all("SELECT locations_json FROM findings WHERE task_id = ?", [task.id]) : [];
    const document = await PDFDocument.load(fs.readFileSync(path.join(uploadDir, book.file_path)));
    for (const finding of findings) {
      for (const location of JSON.parse(finding.locations_json)) {
        const page = document.getPage(location.page - 1);
        page.drawLine({
          start: { x: location.x, y: page.getHeight() - location.y - location.height - 2 },
          end: { x: location.x + location.width, y: page.getHeight() - location.y - location.height - 2 },
          thickness: 1.5,
          color: rgb(0.82, 0.55, 0)
        });
      }
    }
    const output = await document.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${book.title}-划线版.pdf`)}`);
    res.send(Buffer.from(output));
  } catch (error) { next(error); }
});

app.get("/api/books/:id/confirmed-word", async (req, res, next) => {
  try {
    const book = bookForUser(req.params.id, req.user.id);
    if (!book) return res.status(404).json({ error: "书稿不存在" });
    const task = get("SELECT id FROM review_tasks WHERE book_id = ? ORDER BY created_at DESC LIMIT 1", [book.id]);
    const pages = all("SELECT page_number, text FROM pages WHERE book_id = ? AND page_number BETWEEN ? AND ? ORDER BY page_number", [book.id, book.start_page, book.end_page]);
    const findings = task ? all("SELECT * FROM findings WHERE task_id = ? AND review_status = '已确认'", [task.id]) : [];
    const output = await createConfirmedWord(book, pages, findings);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${book.title}-确认版本.docx`)}`);
    res.send(output);
  } catch (error) { next(error); }
});

app.get("/api/books/:id/export", async (req, res, next) => {
  try {
  const book = bookForUser(req.params.id, req.user.id);
  if (!book) return res.status(404).json({ error: "书稿不存在" });
  const task = get("SELECT id FROM review_tasks WHERE book_id = ? ORDER BY created_at DESC LIMIT 1", [book.id]);
  const category = String(req.query.category || "");
  const status = String(req.query.status || "");
  const query = String(req.query.query || "").trim();
  const rows = task ? sortFindings(all("SELECT * FROM findings WHERE task_id = ?", [task.id])).filter((item) =>
    (!category || item.category === category) &&
    (!status || item.review_status === status) &&
    (!query || `${item.quote}${item.explanation}`.includes(query))
  ) : [];
  const data = rows.map((item, index) => ({
    序号: index + 1,
    书名: book.title,
    页码: item.page_number,
    原文: item.quote,
    错误大类: item.category,
    错误小类: item.subcategory,
    错误说明: item.explanation,
    正确文本: item.editor_suggestion || item.suggestion,
    状态: item.review_status
  }));
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("审读意见");
  const headers = ["序号", "书名", "页码", "原文", "错误大类", "错误小类", "错误说明", "正确文本", "状态"];
  worksheet.columns = headers.map((header) => ({ header, key: header, width: ["书名", "原文", "错误说明", "正确文本"].includes(header) ? 32 : 14 }));
  worksheet.addRows(data);
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF276749" } };
  worksheet.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });
  const output = await workbook.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${book.title}-审读意见.xlsx`)}`);
  res.send(Buffer.from(output));
  } catch (error) { next(error); }
});

app.get("/api/sources", (_req, res) => {
  res.json(all(`SELECT s.*, (SELECT COUNT(*) FROM source_versions sv WHERE sv.source_id = s.id) AS version_count,
    (SELECT version FROM source_versions sv WHERE sv.source_id = s.id AND sv.is_current = 1 LIMIT 1) AS current_version
    FROM sources s ORDER BY s.created_at DESC`));
});

app.post("/api/sources", (req, res, next) => {
  try {
    const url = new URL(req.body.url);
    if (url.protocol !== "https:") throw new Error("权威来源必须使用HTTPS地址");
    const id = crypto.randomUUID();
    run("INSERT INTO sources (id, name, url, domain, category, created_at) VALUES (?, ?, ?, ?, ?, ?)", [id, String(req.body.name).trim(), url.toString(), url.hostname, String(req.body.category).trim(), now()]);
    res.status(201).json({ id });
  } catch (error) { next(error); }
});

app.post("/api/sources/:id/sync", async (req, res, next) => {
  try { await syncSource(req.params.id); res.json({ ok: true }); } catch (error) { next(error); }
});

if (process.env.NODE_ENV === "production") {
  const dist = path.join(appRoot, "dist");
  app.use(express.static(dist));
  app.get("/{*splat}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((error, _req, res, _next) => res.status(400).json({ error: error.message || "请求失败" }));
const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
app.listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`);
  migrateReviewText();
  removeDirectoryLayoutFindings();
  for (const task of all("SELECT id FROM review_tasks WHERE status IN ('排队中', '审读中')")) setImmediate(() => runReview(task.id));
});

const syncIntervalMs = Math.max(1, Number(process.env.SOURCE_SYNC_INTERVAL_HOURS || 24)) * 60 * 60 * 1000;
setInterval(async () => {
  const sources = all("SELECT id FROM sources WHERE enabled = 1");
  await Promise.allSettled(sources.map((source) => syncSource(source.id)));
}, syncIntervalMs).unref();
