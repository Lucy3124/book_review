import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

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
  return pages;
}
