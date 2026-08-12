import assert from "node:assert/strict";
import test from "node:test";
import { removeRepeatedMargins } from "../server/pdf.js";

test("removes repeated running headers while preserving body text", () => {
  const pages = Array.from({ length: 12 }, (_, index) => ({
    pageNumber: index + 1,
    width: 600,
    height: 800,
    spans: [
      { text: `| 下 | 半 | 场 | 出 | 发 | ${index + 1}`, x: 100, y: 40, width: 180, height: 12 },
      { text: `正文第${index + 1}页`, x: 60, y: 200, width: 100, height: 12 }
    ]
  }));

  const filtered = removeRepeatedMargins(pages);
  assert.ok(filtered.every((page) => !page.text.includes("下")));
  assert.ok(filtered.every((page) => page.text.includes("正文")));
});
