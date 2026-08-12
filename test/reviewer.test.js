import test from "node:test";
import assert from "node:assert/strict";
import { locateQuote, normalizeFinding } from "../server/reviewer.js";
import { REVIEW_STATUSES, TAXONOMY } from "../server/taxonomy.js";

const pages = [{
  page_number: 12,
  text: "某科学结论需要进一步核验。",
  spans_json: JSON.stringify([{ text: "某科学结论需要进一步核验。", x: 20, y: 80, width: 160, height: 12 }])
}];

test("uses the fixed editorial subcategory vocabulary", () => {
  assert.deepEqual(TAXONOMY[0].children, [
    "法律法规对图书内容导向的规定",
    "涉及法律法规或文件摘录、引用的差错",
    "涉及国土统一、主权和领土完整的差错",
    "涉及党政机构名称、党和国家领导人职务及姓名的差错",
    "涉及民族问题和宗教问题的差错",
    "涉及国家秘密的差错",
    "涉及未成年人教育的差错",
    "涉及台湾地区机构称谓的差错",
    "涉及国际关系的差错"
  ]);
  assert.deepEqual(TAXONOMY[5].children, ["点号差错", "标点差错", "中文出版物夹用英文的标点差错"]);
  assert.deepEqual(REVIEW_STATUSES, ["待判断", "已确认", "已忽略"]);
});

test("rejects categories outside the fixed taxonomy", () => {
  const finding = normalizeFinding({ page_number: 12, quote: "科学结论", subcategory: "模型自创分类" }, pages);
  assert.equal(finding, null);
});

test("downgrades knowledge findings without authoritative evidence", () => {
  const finding = normalizeFinding({
    page_number: 12,
    quote: "科学结论",
    subcategory: "事实性差错",
    finding_level: "明确差错",
    severity: "重要",
    explanation: "与权威资料不符"
  }, pages);
  assert.equal(finding.category, "知识性差错");
  assert.equal(finding.finding_level, "疑似差错");
});

test("routes unsupported scientific judgments to expert review", () => {
  const finding = normalizeFinding({
    page_number: 12,
    quote: "科学结论",
    subcategory: "科学性差错",
    finding_level: "明确差错",
    severity: "严重",
    explanation: "需要专业判断"
  }, pages);
  assert.equal(finding.finding_level, "高风险待专家判断");
});

test("clips quote locations to the matching part of boundary spans", () => {
  const page = {
    page_number: 1,
    spans_json: JSON.stringify([
      { text: "得需要克制。你越克制，", x: 20, y: 80, width: 120, height: 12 },
      { text: "你越有可能能够做成这层事。", x: 20, y: 100, width: 140, height: 12 }
    ])
  };
  const locations = locateQuote(page, "你越克制，你越有可能能够做成这层事。");
  assert.equal(locations.length, 2);
  assert.ok(locations[0].x > 20);
  assert.ok(locations[0].width < 120);
  assert.equal(locations[1].x, 20);
  assert.equal(locations[1].width, 140);
});
