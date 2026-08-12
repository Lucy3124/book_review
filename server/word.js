import {
  Document, Footer, Packer, PageNumber, Paragraph, TextRun
} from "docx";

const BODY_FONT = { ascii: "Arial", hAnsi: "Arial", eastAsia: "SimSun" };

function normalizedTextMap(text) {
  const characters = Array.from(text);
  const indexes = [];
  let normalized = "";
  characters.forEach((character, index) => {
    if (!/\s/.test(character)) {
      normalized += character;
      indexes.push(index);
    }
  });
  return { characters, indexes, normalized };
}

export function applyConfirmedFindings(text, findings) {
  const { characters, indexes, normalized } = normalizedTextMap(text);
  const replacements = [];
  for (const finding of findings) {
    const quote = String(finding.quote || "").replace(/\s+/g, "");
    const replacement = String(finding.editor_suggestion || finding.suggestion || "").trim();
    const start = normalized.indexOf(quote);
    if (start < 0 || !quote || !replacement) continue;
    replacements.push({
      start: indexes[start],
      end: indexes[start + quote.length - 1] + 1,
      replacement
    });
  }
  replacements.sort((a, b) => b.start - a.start);
  let result = characters.join("");
  let rightBoundary = characters.length + 1;
  for (const replacement of replacements) {
    if (replacement.end > rightBoundary) continue;
    result = `${result.slice(0, replacement.start)}${replacement.replacement}${result.slice(replacement.end)}`;
    rightBoundary = replacement.start;
  }
  return result;
}

function manuscriptText(text) {
  return text.replace(/([\p{Script=Han}，。！？；：“”‘’（）《》、])\s+(?=[\p{Script=Han}，。！？；：“”‘’（）《》、])/gu, "$1").trim();
}

export async function createConfirmedWord(book, pages, findings) {
  const confirmedByPage = new Map();
  for (const finding of findings.filter((item) => item.review_status === "已确认")) {
    const pageFindings = confirmedByPage.get(finding.page_number) || [];
    pageFindings.push(finding);
    confirmedByPage.set(finding.page_number, pageFindings);
  }
  const children = [];
  pages.forEach((page, index) => {
    const revised = applyConfirmedFindings(page.text, confirmedByPage.get(page.page_number) || []);
    children.push(new Paragraph({
      pageBreakBefore: index > 0,
      spacing: { after: 160, line: 360 },
      children: [new TextRun({ text: manuscriptText(revised), font: BODY_FONT, size: 24 })]
    }));
  });
  const document = new Document({
    styles: {
      default: {
        document: { run: { font: BODY_FONT, size: 24 }, paragraph: { spacing: { after: 160, line: 360 } } }
      }
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, footer: 708 }
        }
      },
      footers: {
        default: new Footer({ children: [new Paragraph({ alignment: "center", children: [new TextRun({ children: [PageNumber.CURRENT], font: BODY_FONT, size: 18 })] })] })
      },
      children
    }]
  });
  return Packer.toBuffer(document);
}
