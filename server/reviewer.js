import crypto from "node:crypto";
import { all, get, run } from "./db.js";
import { FINDING_LEVELS, SEVERITIES, TAXONOMY, TAXONOMY_MAP } from "./taxonomy.js";

const EVIDENCE_REQUIRED = new Set(["法规与政策类差错", "科技名词差错", "知识性差错"]);
const EXPERT_ONLY = new Set(["涉及国家秘密的差错", "涉及民族问题和宗教问题的差错", "涉及国际关系的差错", "专业性差错", "科学性差错"]);
const TOC_SUBCATEGORIES = new Set(["错别字", "不规范字"]);
const activeReviews = new Map();

const POLICY_REVIEW_GUIDANCE = `法规与政策类差错必须严格按以下九个小类判断：
1. 法律法规对图书内容导向的规定：检查书稿整体或具体表述是否存在有明确规范依据的内容导向风险。不得仅因观点尖锐、人物言论负面或文学作品出现反面内容就判错，必须区分作者立场、人物对白、史料引文、学术转述和批判语境。没有直接规则依据时只能作为高风险待专家判断。
2. 涉及法律法规或文件摘录、引用的差错：核对法律法规、政策文件、公文名称、文号、发布主体、时间、效力状态和引文原文。只有检索资料能够直接证明不一致时才报告；不得凭记忆补写文件名称或引文。
3. 涉及国土统一、主权和领土完整的差错：检查将台湾与国家并列、将西藏与中国并列、港澳台与内地关系表述、行政区划、边界、地图、历史地名及主权归属等。必须结合句法关系判断，不能只因出现“台湾”“香港”“西藏”等词就报告。
4. 涉及党政机构名称、党和国家领导人职务及姓名的差错：核对机构全称、历史时期名称、届次、职务、姓名、会议名称以及讲话主体。必须匹配书稿所述时间，不能拿现行机构名称改写历史机构名称。
5. 涉及民族问题和宗教问题的差错：关注民族称谓、民族历史、宗教教义、宗教宣传、歧视性表达和不当类比。学术介绍、史料原文、人物信仰或明确标注“某宗教认为”的内容不当然构成错误；证据不足时输出高风险待专家判断。
6. 涉及国家秘密的差错：不得判断某信息已经构成泄密，也不得猜测密级。仅在书稿出现疑似未公开的军事、国防、外交、重大工程、内部文件、人员身份或精确设施数据等具体线索时，输出高风险待专家判断，并说明需要人工核查公开属性。
7. 涉及未成年人教育的差错：结合图书读者年龄、体裁和上下文，检查是否违反未成年人保护、教材出版、教育政策或价值引导的明确规定。一般成人图书中的复杂议题不能脱离读者对象直接判错。
8. 涉及台湾地区机构称谓的差错：核对台湾地区机构、职务、学校、博物馆及参考文献中的称谓规范，例如是否需要地域限定或引号。不得把一般涉台主权表述全部归入本类；国家并列和主权关系问题归入第3类。
9. 涉及国际关系的差错：核对国家名称、国际组织、外交关系、战争和国际事件的规范表述。对外国政策的学术评价或历史人物观点不当然构成错误；涉及立场、外交影响且无直接依据时输出高风险待专家判断。

法规政策判断的共同要求：
- “明确差错”必须同时给出具体权威资料名称、有效版本或发布日期、可核验来源链接，并在判断依据中指出书稿原文与依据的直接冲突。
- 只有相关性、潜在争议或价值导向风险而没有直接规则时，不得输出“明确差错”。
- 不得使用搜索摘要、自媒体、百科或模型自身知识作为最终依据。
- 不得为了规避风险而改写正常的学术讨论、文学表达、历史引文或人物对白。
- 资料只能证明部分内容时，只报告能够被证明的部分，不扩大结论。

代表性判断：
- “青山绿水就是金山银山”与权威原文不一致，可归入“法律法规对图书内容导向的规定”，但必须引用权威原文。
- 将“台湾”与美国、日本等国家并列，归入“涉及国土统一、主权和领土完整的差错”；台湾地区具体机构名称不规范，归入“涉及台湾地区机构称谓的差错”。
- 法律条文把“扶养”误引为“抚养”、政策文件名称漏字、讲话原文增字，归入“涉及法律法规或文件摘录、引用的差错”。
- “中国人民共和国”、领导人姓名职务、党政机构历史名称错误，归入“涉及党政机构名称、党和国家领导人职务及姓名的差错”。`;

const LANGUAGE_REVIEW_GUIDANCE = `“多字、漏字、倒字”只报告能够从完整句法和语义中确认的机械性增字、缺字或字序颠倒。连续出现相同汉字不等于多字，必须保留正常叠词、固定表达、构词重叠和不同语法成分相邻的情况：
- “实实在在、的的确确、清清楚楚、来来往往、人人、年年、看看、试试”等是正常表达，不得删字。
- “干不了了、吃不了了、去不了了”中的前一个“了”可属于“不了”结构，后一个“了”可为句末语气词，不得仅因出现“了了”判为多字。
- “是空洞的宏大叙事，而是实实在在的聚沙成塔”中的“实实在在”不得改成“实实在”。
- 只有删除、补入或调换某个字后，句子结构和语义能够得到唯一、明确的修复，且上下文排除正常用法时，才能归入本类。
- 如果只是觉得表达重复、啰嗦或不够简洁，不属于“多字、漏字、倒字”；不要以润色代替纠错。`;

export function cancelReview(taskId) {
  activeReviews.get(taskId)?.abort();
}

function chunkPages(pages, limit = 4500) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const page of pages) {
    if (current.length && size + page.text.length > limit) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(page);
    size += page.text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function getChapter(text) {
  const match = text.slice(0, 180).match(/第[一二三四五六七八九十百零0-9]+[章节篇部][^。；，]{0,30}/);
  return match?.[0] || "";
}

export function markTableOfContentsPages(pages) {
  let inContents = false;
  return pages.map((page) => {
    const compact = page.text.replace(/\s+/g, " ").trim();
    const startsContents = /(^|\s)目录(\s|$)/.test(compact);
    const frontMatterNumber = /^(?:[ivxlcdm]+|[一二三四五六七八九十]+)\s/i.test(compact);
    const entryCount = [...compact.matchAll(/(?:^|\s)[一二三四五六七八九十]+\s+.{2,40}?\s+\d{2,4}(?=\s|$)/g)].length;
    if (startsContents) inContents = true;
    const isTableOfContents = inContents && (startsContents || frontMatterNumber || entryCount >= 2);
    if (inContents && !isTableOfContents) inContents = false;
    return { ...page, is_table_of_contents: isTableOfContents };
  });
}

function sentenceAt(text, matchIndex, matchLength) {
  let start = matchIndex;
  while (start > 0 && !/[。！？.!?\n]/.test(text[start - 1])) start -= 1;
  let end = matchIndex + matchLength;
  if (!/[。！？.!?]/.test(text[end - 1])) {
    while (end < text.length && !/[。！？.!?\n]/.test(text[end])) end += 1;
    if (end < text.length && text[end] !== "\n") end += 1;
  }
  const rawSentence = text.slice(start, end);
  const leadingSpace = rawSentence.length - rawSentence.trimStart().length;
  start += leadingSpace;
  return { start, end, sentence: text.slice(start, end).trimEnd() };
}

export function localFindings(pages) {
  const findings = [];
  for (const page of pages) {
    if (page.is_table_of_contents) continue;
    const rules = [
      {
        regex: /[\u4e00-\u9fff][,;:!?][\u4e00-\u9fff]/g,
        subcategory: "中文出版物夹用英文的标点差错",
        explanation: "中文语句中夹用了英文半角标点。",
        suggestion: (quote) => quote.replace(",", "，").replace(";", "；").replace(":", "：").replace("!", "！").replace("?", "？")
      },
      {
        regex: /([，。！？；：、,!?;:])\1+/g,
        subcategory: "点号差错",
        explanation: "同一位置连续使用了重复点号。",
        suggestion: (quote) => quote[0]
      },
    ];
    for (const rule of rules) {
      for (const match of page.text.matchAll(rule.regex)) {
        const matchedText = match[0];
        const { start, end, sentence } = sentenceAt(page.text, match.index, matchedText.length);
        const relativeIndex = match.index - start;
        const revisedSentence = `${sentence.slice(0, relativeIndex)}${rule.suggestion(matchedText)}${sentence.slice(relativeIndex + matchedText.length)}`;
        findings.push({
          page_number: page.page_number,
          chapter: getChapter(page.text),
          quote: sentence,
          context: page.text.slice(Math.max(0, start - 35), Math.min(page.text.length, end + 35)),
          subcategory: rule.subcategory,
          finding_level: "明确差错",
          severity: "一般",
          explanation: rule.explanation,
          suggestion: revisedSentence,
          evidence: "根据书稿原文形式可直接判定。",
          source_name: "",
          source_version: "",
          source_url: ""
        });
      }
    }
  }
  return findings;
}

function sourceWindow(content, manuscript) {
  const windowSize = 2400;
  if (content.length <= windowSize) return content;
  const manuscriptGrams = new Set();
  const compact = manuscript.replace(/\s+/g, "");
  for (let index = 0; index <= compact.length - 4; index += 1) manuscriptGrams.add(compact.slice(index, index + 4));
  let bestStart = 0;
  let bestScore = -1;
  for (let start = 0; start < content.length; start += 1200) {
    const window = content.slice(start, start + windowSize).replace(/\s+/g, "");
    let score = 0;
    for (let index = 0; index <= window.length - 4; index += 1) {
      if (manuscriptGrams.has(window.slice(index, index + 4))) score += 1;
    }
    if (score > bestScore) {
      bestStart = start;
      bestScore = score;
    }
  }
  return content.slice(bestStart, bestStart + windowSize);
}

function sourceExcerpts(sources, manuscript) {
  return sources.map((source) => {
    const excerpt = sourceWindow(source.content, manuscript);
    const compactExcerpt = excerpt.replace(/\s+/g, "");
    const compactManuscript = manuscript.replace(/\s+/g, "");
    let relevance = 0;
    for (let index = 0; index <= compactExcerpt.length - 4; index += 1) {
      if (compactManuscript.includes(compactExcerpt.slice(index, index + 4))) relevance += 1;
    }
    return {
      relevance,
      name: source.source_name,
      version: source.version,
      url: source.url,
      excerpt
    };
  }).sort((left, right) => right.relevance - left.relevance).slice(0, 6).map(({ relevance, ...source }) => source);
}

async function modelFindings(pages, sources, signal) {
  const deterministicFindings = localFindings(pages);
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return deterministicFindings;
  const baseUrl = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const subcategories = TAXONOMY.flatMap((group) => group.children);
  const manuscript = pages.map((page) => `[第${page.page_number}页${page.is_table_of_contents ? "｜页面类型：目录" : ""}]\n${page.text}`).join("\n\n");
  const references = sourceExcerpts(sources, manuscript);
  const messages = [
    {
      role: "system",
      content: `你是出版社书稿审读员。只报告能够指向原文的具体问题，目标是尽量查全，但不得编造事实、依据或来源。标记为“页面类型：目录”的页面可能包含横排、竖排、多栏或装饰性排版，PDF提取后的文字顺序不代表视觉阅读顺序。目录页只检查文字本身是否存在错别字或不规范字，只能使用“错别字”或“不规范字”两个subcategory；不得判断目录的章节顺序、编号、页码、标题缺失、文字排列、对齐、标点、语法、词语、知识或版式问题。\n\n${POLICY_REVIEW_GUIDANCE}\n\n${LANGUAGE_REVIEW_GUIDANCE}\n\nsubcategory只能逐字取自下面这个数组，数组之外的任何值一律禁止：\n${JSON.stringify(subcategories)}\n\n结论等级只能为：明确差错、疑似差错、高风险待专家判断。涉及法规政策、科技名词、事实或科学判断的问题，没有资料依据时不得标为明确差错。涉及国家秘密、民族宗教、国际关系、专业科技或科学判断的问题证据不足时应标为高风险待专家判断。quote字段必须是包含错误的完整原句，并逐字来自书稿；suggestion字段必须把修改动作实际应用到quote中，返回修改完成后的完整句子，不要返回“将A改为B”一类操作说明，也不要只返回被修改的词语。例如quote为“青山绿水就是金山银山。”，错误说明为“将‘青山绿水’改为‘绿水青山’”，suggestion必须返回“绿水青山就是金山银山。”。确实无法给出确定改句时填写“需编辑确认”。\n\n你必须只返回一个可被JSON.parse直接解析的JSON对象，禁止输出解释、致歉、Markdown代码块或JSON之外的任何文字。返回结构：{"findings":[{"page_number":1,"chapter":"","quote":"包含错误的完整原句","context":"原文上下文","subcategory":"必须逐字取自允许数组","finding_level":"明确差错","severity":"严重|重要|一般","explanation":"问题说明","suggestion":"修改完成后的完整句子","evidence":"判断依据","source_name":"资料名称","source_version":"资料版本","source_url":"来源链接"}]}。没有问题时返回{"findings":[]}。`
    },
    {
      role: "user",
      content: `审读以下书稿片段。权威资料仅限附后的资料版本；不得引用清单外来源。\n\n书稿：\n${manuscript}\n\n权威资料：\n${JSON.stringify(references)}`
    }
  ];
  for (let formatAttempt = 1; formatAttempt <= 3; formatAttempt += 1) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0.1, response_format: { type: "json_object" }, messages })
    });
    if (!response.ok) {
      const error = new Error(`模型调用失败：HTTP ${response.status}`);
      error.status = response.status;
      error.retryAfterMs = Number(response.headers.get("retry-after") || 0) * 1000;
      throw error;
    }
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content || "";
    try {
      const parsed = parseModelFindingsContent(content);
      return [...deterministicFindings, ...parsed.findings];
    } catch (error) {
      if (formatAttempt === 3) throw error;
      messages.push(
        { role: "assistant", content },
        { role: "user", content: "你刚才的回复不是合法JSON。请重新回答，只输出一个可被JSON.parse直接解析的JSON对象，格式必须为{\"findings\":[]}，不要输出任何其他文字。" }
      );
    }
  }
}

export function parseModelFindingsContent(content) {
  try {
    const parsed = JSON.parse(String(content || ""));
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.findings)) throw new Error();
    return parsed;
  } catch {
    const error = new Error("模型未按要求返回结构化审读结果，已自动校正3次仍失败");
    error.code = "MODEL_INVALID_JSON";
    throw error;
  }
}

export function locateQuote(page, quote) {
  const spans = JSON.parse(page.spans_json);
  const direct = spans.find((span) => span.text.includes(quote));
  if (direct) {
    const offset = direct.text.indexOf(quote);
    const unitWidth = direct.width / Math.max(1, direct.text.length);
    return [{
      page: page.page_number,
      x: direct.x + offset * unitWidth,
      y: direct.y - direct.height,
      width: Math.max(unitWidth, quote.length * unitWidth),
      height: direct.height
    }];
  }
  const target = quote.replace(/\s+/g, "");
  const combined = spans.map((span) => span.text.replace(/\s+/g, "")).join("");
  const start = combined.indexOf(target);
  if (start < 0) return [];
  const end = start + target.length;
  let cursor = 0;
  const locations = [];
  for (const span of spans) {
    const characters = Array.from(span.text);
    const visibleIndexes = characters.flatMap((character, index) => /\s/.test(character) ? [] : [index]);
    const length = visibleIndexes.length;
    const overlapStart = Math.max(start, cursor);
    const overlapEnd = Math.min(end, cursor + length);
    if (overlapStart < overlapEnd) {
      const firstVisible = overlapStart - cursor;
      const lastVisible = overlapEnd - cursor - 1;
      const characterStart = visibleIndexes[firstVisible];
      const characterEnd = visibleIndexes[lastVisible] + 1;
      const unitWidth = span.width / Math.max(1, characters.length);
      locations.push({
        page: page.page_number,
        x: span.x + characterStart * unitWidth,
        y: span.y - span.height,
        width: Math.max(unitWidth, (characterEnd - characterStart) * unitWidth),
        height: span.height
      });
    }
    cursor += length;
  }
  return locations;
}

export function normalizeFinding(raw, pages, sources = []) {
  const subcategory = String(raw.subcategory || "");
  const category = TAXONOMY_MAP.get(subcategory);
  if (!category) return null;
  const pageNumber = Number(raw.page_number);
  const page = pages.find((item) => item.page_number === pageNumber);
  const quote = String(raw.quote || "").trim();
  if (!page || !quote || !page.text.replace(/\s+/g, "").includes(quote.replace(/\s+/g, ""))) return null;
  if (page.is_table_of_contents && !TOC_SUBCATEGORIES.has(subcategory)) return null;

  let findingLevel = FINDING_LEVELS.includes(raw.finding_level) ? raw.finding_level : "疑似差错";
  const citedSource = sources.find((source) => source.url === raw.source_url && source.version === raw.source_version);
  const hasSource = Boolean(raw.evidence && raw.source_name && citedSource);
  if (EXPERT_ONLY.has(subcategory)) findingLevel = "高风险待专家判断";
  else if (EVIDENCE_REQUIRED.has(category) && findingLevel === "明确差错" && !hasSource) findingLevel = "疑似差错";
  return {
    ...raw,
    page_number: pageNumber,
    category,
    subcategory,
    quote,
    chapter: String(raw.chapter || getChapter(page.text)),
    context: String(raw.context || page.text.slice(Math.max(0, page.text.indexOf(quote) - 40), page.text.indexOf(quote) + quote.length + 40)),
    finding_level: findingLevel,
    severity: SEVERITIES.includes(raw.severity) ? raw.severity : "一般",
    explanation: String(raw.explanation || ""),
    suggestion: String(raw.suggestion || ""),
    evidence: hasSource ? String(raw.evidence) : "",
    source_name: hasSource ? citedSource.source_name : "",
    source_version: hasSource ? citedSource.version : "",
    source_url: hasSource ? citedSource.url : "",
    locations: locateQuote(page, quote)
  };
}

async function mapLimit(items, limit, handler) {
  let cursor = 0;
  const results = new Array(items.length);
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await handler(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function waitForRetry(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason || new Error("审读已取消"));
    }, { once: true });
  });
}

async function reviewChunkWithRetry(taskId, chunk, sources, signal) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try { return await modelFindings(chunk, sources, signal); }
    catch (error) {
      lastError = error;
      if (error.code === "MODEL_INVALID_JSON" && chunk.length > 1) {
        run("UPDATE review_tasks SET stage = ? WHERE id = ?", [`模型格式异常，改为逐页审读第${chunk[0].page_number}-${chunk.at(-1).page_number}页`, taskId]);
        const findings = [];
        for (const page of chunk) findings.push(...await reviewChunkWithRetry(taskId, [page], sources, signal));
        run("UPDATE review_tasks SET stage = '分块并行审读' WHERE id = ?", [taskId]);
        return findings;
      }
      if (error.status !== 429 || attempt === 3) continue;
      const delayMs = error.retryAfterMs || attempt * 30000;
      run("UPDATE review_tasks SET stage = ? WHERE id = ?", [`模型限流，${Math.ceil(delayMs / 1000)}秒后重试`, taskId]);
      await waitForRetry(delayMs, signal);
      run("UPDATE review_tasks SET stage = '分块并行审读' WHERE id = ?", [taskId]);
    }
  }
  throw lastError;
}

export async function runReview(taskId) {
  const controller = new AbortController();
  activeReviews.set(taskId, controller);
  const task = get("SELECT * FROM review_tasks WHERE id = ?", [taskId]);
  if (!task) { activeReviews.delete(taskId); return; }
  const book = get("SELECT * FROM books WHERE id = ?", [task.book_id]);
  const pages = markTableOfContentsPages(all("SELECT * FROM pages WHERE book_id = ? AND page_number BETWEEN ? AND ? ORDER BY page_number", [book.id, book.start_page, book.end_page]));
  const snapshotIds = JSON.parse(task.source_snapshot || "[]");
  const sources = snapshotIds.length
    ? all(`SELECT sv.*, s.name AS source_name FROM source_versions sv JOIN sources s ON s.id = sv.source_id WHERE sv.id IN (${snapshotIds.map(() => "?").join(",")})`, snapshotIds)
    : [];
  const chunks = chunkPages(pages);
  for (let index = 0; index < chunks.length; index += 1) {
    run(`INSERT OR IGNORE INTO review_units (id, task_id, chunk_index, status, updated_at)
      VALUES (?, ?, ?, '待处理', ?)`, [crypto.randomUUID(), taskId, index, new Date().toISOString()]);
  }
  run("UPDATE review_tasks SET status = '审读中', stage = '分块并行审读', progress = 2 WHERE id = ?", [taskId]);
  run("UPDATE books SET status = '审读中', updated_at = ? WHERE id = ?", [new Date().toISOString(), book.id]);
  try {
    let completed = Number(get("SELECT COUNT(*) AS count FROM review_units WHERE task_id = ? AND status = '已完成'", [taskId]).count);
    const grouped = await mapLimit(chunks, 2, async (chunk, index) => {
      const unit = get("SELECT * FROM review_units WHERE task_id = ? AND chunk_index = ?", [taskId, index]);
      let findings;
      if (unit.status === "已完成" && unit.result_json) {
        findings = JSON.parse(unit.result_json);
      } else {
        run("UPDATE review_units SET status = '处理中', error = NULL, updated_at = ? WHERE id = ?", [new Date().toISOString(), unit.id]);
        try {
          findings = await reviewChunkWithRetry(taskId, chunk, sources, controller.signal);
          run("UPDATE review_units SET status = '已完成', result_json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(findings), new Date().toISOString(), unit.id]);
          completed += 1;
        } catch (error) {
          run("UPDATE review_units SET status = '失败', error = ?, updated_at = ? WHERE id = ?", [error.message, new Date().toISOString(), unit.id]);
          throw error;
        }
      }
      const progress = Math.round(5 + (completed / chunks.length) * 85);
      run("UPDATE review_tasks SET progress = ? WHERE id = ?", [progress, taskId]);
      return findings.map((finding) => normalizeFinding(finding, chunk, sources)).filter(Boolean);
    });
    run("UPDATE review_tasks SET stage = '合并与定位', progress = 94 WHERE id = ?", [taskId]);
    const unique = new Map();
    for (const finding of grouped.flat()) {
      const key = `${finding.page_number}|${finding.subcategory}|${finding.quote}`;
      if (!unique.has(key)) unique.set(key, finding);
    }
    run("DELETE FROM findings WHERE book_id = ?", [book.id]);
    for (const finding of unique.values()) {
      run(
        `INSERT INTO findings
         (id, book_id, task_id, page_number, chapter, quote, context, category, subcategory, finding_level, severity,
          explanation, suggestion, evidence, source_name, source_version, source_url, locations_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), book.id, taskId, finding.page_number, finding.chapter, finding.quote, finding.context,
          finding.category, finding.subcategory, finding.finding_level, finding.severity, finding.explanation, finding.suggestion,
          finding.evidence, finding.source_name, finding.source_version, finding.source_url, JSON.stringify(finding.locations), new Date().toISOString()]
      );
    }
    run("UPDATE review_tasks SET status = '已完成', stage = '已完成', progress = 100, completed_at = ? WHERE id = ?", [new Date().toISOString(), taskId]);
    run("UPDATE books SET status = '待复核', updated_at = ? WHERE id = ?", [new Date().toISOString(), book.id]);
  } catch (error) {
    run("UPDATE review_tasks SET status = '失败', stage = '处理失败', error = ? WHERE id = ?", [error.message, taskId]);
    run("UPDATE books SET status = '审读失败', updated_at = ? WHERE id = ?", [new Date().toISOString(), book.id]);
  } finally {
    activeReviews.delete(taskId);
  }
}
