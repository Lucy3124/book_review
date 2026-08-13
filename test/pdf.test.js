import assert from "node:assert/strict";
import test from "node:test";
import { prepareReviewPages, removeRepeatedMargins, reviewTextFromSpans } from "../server/pdf.js";

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

test("does not insert spaces between PDF text spans or wrapped Chinese lines", () => {
  const text = reviewTextFromSpans([
    { text: "自己依然可以与这个精彩的世", x: 90, y: 120 },
    { text: "界进行着有意义的互动。", x: 90, y: 144 }
  ]);
  assert.equal(text, "自己依然可以与这个精彩的世\n界进行着有意义的互动。");
  assert.equal(text.replace(/\s+/g, ""), "自己依然可以与这个精彩的世界进行着有意义的互动。");
});

test("removes text outside the inferred body column", () => {
  const [page] = prepareReviewPages([{
    pageNumber: 139,
    width: 448,
    height: 669,
    spans: [
      { text: "第三章", x: 45, y: 66, width: 32, height: 8 },
      { text: "故土新园", x: 45, y: 245, width: 32, height: 8 },
      { text: "121", x: 45, y: 608, width: 17, height: 9 },
      { text: "意识地摩挲着那道深深的刻痕，一遍又一遍。", x: 110, y: 69, width: 210, height: 10.5 },
      { text: "我蹲下身，郑重地说，这门墩是念想。", x: 110, y: 89, width: 260, height: 10.5 },
      { text: "只要您需要，我们工作组一定负责。", x: 110, y: 109, width: 250, height: 10.5 }
    ]
  }]);
  assert.ok(!page.text.includes("故土新园"));
  assert.ok(!page.text.includes("121"));
  assert.ok(page.text.includes("意识地摩挲"));
});
