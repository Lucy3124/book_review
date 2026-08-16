import test from "node:test";
import assert from "node:assert/strict";
import { localFindings, locateQuote, manuscriptTextForModel, markTableOfContentsPages, normalizeFinding, parseModelFindingsContent } from "../server/reviewer.js";
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

test("accepts only a JSON object containing a findings array", () => {
  assert.deepEqual(parseModelFindingsContent('{"findings":[]}'), { findings: [] });
  assert.throws(
    () => parseModelFindingsContent("关于这个问题，我还在分析。"),
    { code: "MODEL_INVALID_JSON" }
  );
});

test("does not treat table of contents leader dots as punctuation errors", () => {
  const findings = localFindings([{ page_number: 7, text: "一、伦敦的天气 ................................ 005", is_table_of_contents: true }]);
  assert.equal(findings.length, 0);
});

test("does not treat valid reduplication or adjacent le particles as extra characters", () => {
  const findings = localFindings([{
    page_number: 1,
    text: "这不是空洞的宏大叙事，而是实实在在的聚沙成塔。他已经干不了了。"
  }]);
  assert.equal(findings.filter((finding) => finding.subcategory === "多字、漏字、倒字").length, 0);
});

test("removes PDF line and column breaks from model input", () => {
  const text = manuscriptTextForModel([{ page_number: 103, text: "她马上跟女\n红军聊开了。" }]);
  assert.equal(text, "[第103页]\n她马上跟女红军聊开了。");
});

test("always routes possible state secret issues to expert review", () => {
  const page = { page_number: 1, text: "该内部设施数据需要核查。", spans_json: "[]" };
  const finding = normalizeFinding({
    page_number: 1,
    quote: page.text,
    subcategory: "涉及国家秘密的差错",
    finding_level: "明确差错",
    evidence: "公开属性需要核查",
    source_name: "某资料",
    source_version: "2026",
    source_url: "https://example.com"
  }, [page], [{ source_name: "某资料", version: "2026", url: "https://example.com" }]);
  assert.equal(finding.finding_level, "高风险待专家判断");
});

test("does not accept a model-invented policy source as evidence", () => {
  const page = { page_number: 1, text: "某政策固定表述。", spans_json: "[]" };
  const finding = normalizeFinding({
    page_number: 1,
    quote: page.text,
    subcategory: "涉及法律法规或文件摘录、引用的差错",
    finding_level: "明确差错",
    evidence: "与文件原文不一致",
    source_name: "虚构文件",
    source_version: "2026",
    source_url: "https://example.com/invented"
  }, [page], [{ source_name: "真实文件", version: "2026", url: "https://example.com/real" }]);
  assert.equal(finding.finding_level, "疑似差错");
  assert.equal(finding.source_url, "");
});

test("marks consecutive front matter contents pages", () => {
  const marked = markTableOfContentsPages([
    { page_number: 3, text: "待补示意图" },
    { page_number: 4, text: "ii 第一章 目录 一 西江黄金水道 008 二 古盐道 012" },
    { page_number: 5, text: "iii 第二章 一 运河办纪事 043 二 岁月如河 056" },
    { page_number: 6, text: "第一章 正文从这里开始。" }
  ]);
  assert.deepEqual(marked.map((page) => page.is_table_of_contents), [false, true, true, false]);
});

test("rejects non-character findings on contents pages", () => {
  const page = { page_number: 4, text: "一 第一节 008 六", spans_json: "[]", is_table_of_contents: true };
  assert.equal(normalizeFinding({ page_number: 4, quote: page.text, subcategory: "多字、漏字、倒字" }, [page]), null);
  assert.equal(normalizeFinding({ page_number: 4, quote: "第一节", subcategory: "错别字" }, [page]).subcategory, "错别字");
});
