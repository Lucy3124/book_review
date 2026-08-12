import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

function lineKey(text) {
  return text.replace(/\s+/g, "").replace(/[\d一二三四五六七八九十百千]+/g, "");
}

export function removeRepeatedMargins(pages) {
  const occurrences = new Map();
  const pageLines = pages.map((page) => {
    const lines = [];
    for (const span of page.spans) {
      if (span.y > page.height * 0.14 && span.y < page.height * 0.9) continue;
      const line = lines.find((item) => Math.abs(item.y - span.y) <= 3);
      if (line) line.spans.push(span);
      else lines.push({ y: span.y, spans: [span] });
    }
    for (const line of lines) {
      line.spans.sort((a, b) => a.x - b.x);
      line.key = lineKey(line.spans.map((span) => span.text).join(""));
      if (line.key.length < 2) continue;
      if (!occurrences.has(line.key)) occurrences.set(line.key, new Set());
      occurrences.get(line.key).add(page.pageNumber);
    }
    return lines;
  });
  const threshold = Math.max(3, Math.ceil(pages.length * 0.08));
  const repeated = new Set([...occurrences].filter(([, pageNumbers]) => pageNumbers.size >= threshold).map(([key]) => key));
  return pages.map((page, index) => {
    const excluded = new Set(pageLines[index].filter((line) => repeated.has(line.key)).flatMap((line) => line.spans));
    const spans = page.spans.filter((span) => !excluded.has(span));
    return { ...page, spans, text: spans.map((span) => span.text).join(" ") };
  });
}

export async function extractPdf(buffer) {
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const spans = content.items
      .filter((item) => item.str?.trim())
      .map((item) => ({
        text: item.str,
        x: item.transform[4],
        y: viewport.height - item.transform[5],
        width: item.width,
        height: Math.max(Math.abs(item.transform[3]), 8)
      }));
    pages.push({
      pageNumber,
      text: spans.map((span) => span.text).join(" "),
      spans,
      width: viewport.width,
      height: viewport.height
    });
  }
  return removeRepeatedMargins(pages);
}
