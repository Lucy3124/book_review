import crypto from "node:crypto";
import * as cheerio from "cheerio";
import { extractPdf } from "./pdf.js";
import { all, get, run } from "./db.js";

function cleanHtml(html) {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, noscript").remove();
  const title = $("title").first().text().trim();
  const content = $("article, main").first().text() || $("body").text();
  return { title, content: content.replace(/\s+/g, " ").trim() };
}

export async function syncSource(sourceId) {
  const source = get("SELECT * FROM sources WHERE id = ?", [sourceId]);
  if (!source) throw new Error("资料来源不存在");
  const parsed = new URL(source.url);
  if (parsed.hostname !== source.domain) throw new Error("来源地址不属于已登记域名");

  run("UPDATE sources SET sync_status = '同步中' WHERE id = ?", [sourceId]);
  try {
    const response = await fetch(source.url, { headers: { "user-agent": "ManuscriptReviewBot/1.0" } });
    if (!response.ok) throw new Error(`抓取失败：HTTP ${response.status}`);
    const type = response.headers.get("content-type") || "";
    let title = source.name;
    let content = "";
    if (type.includes("pdf") || source.url.toLowerCase().endsWith(".pdf")) {
      const pages = await extractPdf(Buffer.from(await response.arrayBuffer()));
      content = pages.map((page) => page.text).join("\n");
    } else {
      const parsedHtml = cleanHtml(await response.text());
      title = parsedHtml.title || title;
      content = parsedHtml.content;
    }
    if (!content) throw new Error("未提取到有效正文");

    const hash = crypto.createHash("sha256").update(content).digest("hex");
    const existing = get("SELECT id FROM source_versions WHERE source_id = ? AND content_hash = ?", [sourceId, hash]);
    if (!existing) {
      run("UPDATE source_versions SET is_current = 0 WHERE source_id = ?", [sourceId]);
      run(
        `INSERT INTO source_versions
         (id, source_id, version, title, content, fetched_at, content_hash, url, is_current)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [crypto.randomUUID(), sourceId, new Date().toISOString().slice(0, 10), title, content, new Date().toISOString(), hash, source.url]
      );
    }
    run("UPDATE sources SET sync_status = '已同步', last_synced_at = ? WHERE id = ?", [new Date().toISOString(), sourceId]);
  } catch (error) {
    run("UPDATE sources SET sync_status = ? WHERE id = ?", [`失败：${error.message}`, sourceId]);
    throw error;
  }
}

export function currentSources() {
  return all(`
    SELECT sv.*, s.name AS source_name, s.category
    FROM source_versions sv
    JOIN sources s ON s.id = sv.source_id
    WHERE sv.is_current = 1 AND s.enabled = 1
  `);
}
