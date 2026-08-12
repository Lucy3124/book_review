import test from "node:test";
import assert from "node:assert/strict";
import { applyConfirmedFindings } from "../server/word.js";

test("uses the editor text when applying a confirmed finding", () => {
  const result = applyConfirmedFindings("前文 你不克制，你就不起。 后文", [{
    quote: "你不克制，你就不起。",
    suggestion: "你不克制，你就不能。",
    editor_suggestion: "你不克制，你就不行。"
  }]);
  assert.equal(result, "前文 你不克制，你就不行。 后文");
});

test("uses the AI text when no editor text exists", () => {
  const result = applyConfirmedFindings("你不克制，你就不起。", [{
    quote: "你不克制，你就不起。",
    suggestion: "你不克制，你就不行。",
    editor_suggestion: ""
  }]);
  assert.equal(result, "你不克制，你就不行。");
});
