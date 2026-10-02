/* PDF engine (jsPDF + autoTable + Noto Sans subset). Turns "blocks" into a downloadable PDF. */
const VENDOR = ['./vendor/jspdf.umd.min.js', './vendor/jspdf.plugin.autotable.min.js', './vendor/pdf-fonts.js'];
let loading = null;

function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
}
async function ensureLib() {
  if (window.jspdf && window.PDF_FONTS && window.jspdf.jsPDF.API.autoTable) return;
  if (!loading) loading = (async () => { await loadScript(VENDOR[0]); await loadScript(VENDOR[1]); await loadScript(VENDOR[2]); })().catch((e) => { loading = null; throw e; });
  await loading;
}
/* warm the library after unlock so the first PDF is quick */
export function preload() { return ensureLib().catch(() => {}); }

const C = {
  navy: [20, 33, 61], ink: [20, 33, 61], ink2: [68, 80, 106], muted: [124, 134, 152], line: [228, 220, 208], red: [200, 16, 46], sea: [14, 124, 134],
  gold: [185, 138, 18], goldBg: [251, 242, 218], redBg: [253, 231, 231], seaBg: [225, 242, 243], okBg: [229, 243, 230], zebra: [248, 245, 240],
  mode: { taxi_out: [108, 63, 181], taxi: [224, 123, 36], taxi_home: [194, 24, 91], walk: [17, 137, 127], ferry: [31, 111, 178], tram: [184, 134, 11],
          shuttle: [84, 110, 122], flight: [127, 140, 141], ebus: [142, 108, 58] },
};
const PAGE = { w: 210, h: 297, m: 16 };

/* the embedded font covers Latin, Turkish, ₺ € and a few arrows; anything else (Arabic, emoji) would print as boxes */
const clean = (s) => String(s ?? '').replace(/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]+/g, '…').replace(/[\uD800-\uDFFF]/g, '').replace(/ /g, ' ');
const deepClean = (v) => typeof v === 'string' ? clean(v) : Array.isArray(v) ? v.map(deepClean) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'src' ? x : deepClean(x)])) : v;

export async function makePdf({ title, subtitle = '', blocks = [], filename = 'turkiye-2026.pdf', share = true, deliverIt = true }) {
  await ensureLib();
  title = clean(title); subtitle = clean(subtitle); blocks = deepClean(blocks);
  const { jsPDF } = window.jspdf;
  // putOnlyUsedFonts: no unembedded standard fonts in the file, so Acrobat can stamp and sign it
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
  doc.addFileToVFS('NotoSans-Regular.ttf', window.PDF_FONTS.regular); doc.addFont('NotoSans-Regular.ttf', 'Noto', 'normal');
  doc.addFileToVFS('NotoSans-Bold.ttf', window.PDF_FONTS.bold); doc.addFont('NotoSans-Bold.ttf', 'Noto', 'bold');
  doc.setFont('Noto', 'normal');
  doc.setProperties({ title, subject: subtitle, creator: 'Türkiye 2026 app', author: 'Türkiye 2026' });
  const W = PAGE.w - PAGE.m * 2;
  let y = 0;

  // first-page header band
  doc.setFillColor(...C.navy); doc.rect(0, 0, PAGE.w, 34, 'F');
  doc.setFillColor(...C.red); doc.rect(0, 34, PAGE.w, 1.6, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('Noto', 'bold'); doc.setFontSize(18);
  doc.text(fit(doc, title, W), PAGE.m, 15);
  doc.setFont('Noto', 'normal'); doc.setFontSize(10.5); doc.setTextColor(214, 222, 236);
  doc.text(fit(doc, subtitle || 'Türkiye 2026', W), PAGE.m, 24);
  doc.setFontSize(8.5); doc.text('Made ' + new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }), PAGE.m, 30);
  y = 44;

  const need = (h) => { if (y + h > PAGE.h - 18) { doc.addPage(); y = 18; } };
  const text = (str, { size = 10.5, bold = false, color = C.ink, indent = 0, lh = 1.38, gap = 2 } = {}) => {
    doc.setFont('Noto', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(str ?? ''), W - indent);
    const step = size * 0.3528 * lh;
    for (const ln of lines) { need(step); doc.text(ln, PAGE.m + indent, y + size * 0.3528); y += step; }
    y += gap;
  };

  for (const b of blocks) {
    if (!b) continue;
    switch (b.t) {
      case 'h': need(14); y += 3; text(b.text, { size: 13.5, bold: true, color: C.navy, gap: 1 });
        doc.setDrawColor(...C.red); doc.setLineWidth(0.6); doc.line(PAGE.m, y, PAGE.m + 14, y); y += 4; break;
      case 'h3': need(9); text(b.text, { size: 11.5, bold: true, color: C.ink2, gap: 1.5 }); break;
      case 'p': text(b.text, { size: b.size || 10.5, color: b.muted ? C.muted : C.ink }); break;
      case 'list': {
        (b.items || []).forEach((it, i) => {
          const bullet = b.ordered ? `${i + 1}.` : '•';
          doc.setFont('Noto', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...(b.ordered ? C.red : C.ink2));
          const lines = doc.splitTextToSize(String(it), W - 8); const step = 10.5 * 0.3528 * 1.38;
          need(step * Math.min(lines.length, 2));
          doc.text(bullet, PAGE.m, y + 3.7);
          doc.setFont('Noto', 'normal'); doc.setTextColor(...C.ink);
          for (const ln of lines) { need(step); doc.text(ln, PAGE.m + 8, y + 3.7); y += step; }
          y += 1.6;
        }); y += 1.5; break;
      }
      case 'kv': {
        doc.autoTable({ startY: y, margin: { left: PAGE.m, right: PAGE.m }, theme: 'plain', body: b.rows,
          styles: { font: 'Noto', fontSize: 10, cellPadding: { top: 1.6, bottom: 1.6, left: 0, right: 3 }, textColor: C.ink, overflow: 'linebreak' },
          columnStyles: { 0: { textColor: C.muted, cellWidth: b.keyWidth || 46 }, 1: { fontStyle: 'bold' } } });
        y = doc.lastAutoTable.finalY + 4; break;
      }
      case 'table': {
        doc.autoTable({ startY: y, margin: { left: PAGE.m, right: PAGE.m }, head: b.head ? [b.head] : undefined, body: b.rows, theme: 'grid',
          styles: { font: 'Noto', fontSize: b.size || 9.5, cellPadding: 2.2, textColor: C.ink, lineColor: C.line, lineWidth: 0.2, overflow: 'linebreak', valign: 'top' },
          headStyles: { fillColor: C.navy, textColor: [255, 255, 255], fontStyle: 'bold' },
          alternateRowStyles: { fillColor: C.zebra }, columnStyles: b.columns || {},
          didParseCell: (d) => { if (b.boldLast && d.section === 'body' && d.row.index === b.rows.length - 1) d.cell.styles.fontStyle = 'bold'; } });
        y = doc.lastAutoTable.finalY + 5; break;
      }
      case 'trips': {
        const rows = b.trips.map(t => [String(t.n), t.time || '', t.modeText, t.label, t.dur || '']);
        doc.autoTable({ startY: y, margin: { left: PAGE.m, right: PAGE.m }, head: [['#', 'Time', 'How', 'From → To', 'Takes']], body: rows, theme: 'grid',
          styles: { font: 'Noto', fontSize: 9.3, cellPadding: 2, textColor: C.ink, lineColor: C.line, lineWidth: 0.2, overflow: 'linebreak', valign: 'middle' },
          headStyles: { fillColor: C.navy, textColor: [255, 255, 255], fontStyle: 'bold' },
          columnStyles: { 0: { cellWidth: 8, halign: 'center', fontStyle: 'bold', textColor: [255, 255, 255] }, 1: { cellWidth: 14 }, 2: { cellWidth: 30, fontStyle: 'bold' }, 4: { cellWidth: 38 } },
          didParseCell: (d) => { if (d.section === 'body') { const t = b.trips[d.row.index]; const col = C.mode[t.mode] || C.ink2;
            if (d.column.index === 0) d.cell.styles.fillColor = col; if (d.column.index === 2) d.cell.styles.textColor = col; } } });
        y = doc.lastAutoTable.finalY + 5; break;
      }
      case 'image': {
        if (!b.src) break;
        const w = b.w || W, h = w * (b.ratio || 0.722);
        need(h + 6); doc.addImage(b.src, b.format || 'JPEG', PAGE.m, y, w, h, undefined, 'FAST'); y += h + 2;
        if (b.caption) text(b.caption, { size: 8.5, color: C.muted }); else y += 3; break;
      }
      case 'callout': {
        const bg = { red: C.redBg, sea: C.seaBg, ok: C.okBg }[b.tone] || C.goldBg;
        doc.setFont('Noto', 'normal'); doc.setFontSize(10);
        const lines = doc.splitTextToSize(String(b.text), W - 8); const h = (lines.length + (b.label ? 1 : 0)) * 4.9 + 6;
        need(h + 3); doc.setFillColor(...bg); doc.roundedRect(PAGE.m, y, W, h, 2, 2, 'F');
        doc.setTextColor(...C.ink); let yy = y + 6.2;
        if (b.label) { doc.setFont('Noto', 'bold'); doc.text(String(b.label), PAGE.m + 4, yy); yy += 4.9; }
        doc.setFont('Noto', 'normal');
        lines.forEach((ln) => { doc.text(ln, PAGE.m + 4, yy); yy += 4.9; });
        y += h + 4; break;
      }
      case 'total': {
        need(12); doc.setDrawColor(...C.navy); doc.setLineWidth(0.5); doc.line(PAGE.m, y, PAGE.m + W, y); y += 6;
        doc.setFont('Noto', 'bold'); doc.setFontSize(12.5); doc.setTextColor(...C.navy);
        doc.text(String(b.label), PAGE.m, y); doc.text(String(b.value), PAGE.m + W, y, { align: 'right' }); y += 7; break;
      }
      case 'big': {
        doc.setFont('Noto', 'bold'); doc.setFontSize(b.size || 26);
        const lines = doc.splitTextToSize(String(b.text), W); const step = (b.size || 26) * 0.3528 * 1.25;
        need(lines.length * step + 6); doc.setTextColor(...C.ink);
        for (const ln of lines) { doc.text(ln, PAGE.m, y + (b.size || 26) * 0.3528); y += step; }
        y += 6; break;
      }
      case 'pagebreak': doc.addPage(); y = 18; break;
      case 'space': y += b.h || 4; break;
    }
  }

  // running footer
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFont('Noto', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.muted);
    doc.text('Türkiye 2026 · private trip companion', PAGE.m, PAGE.h - 8);
    doc.text(`${i} / ${n}`, PAGE.w - PAGE.m, PAGE.h - 8, { align: 'right' });
    if (i > 1) { doc.text(fit(doc, title, 120), PAGE.m, 10); doc.setDrawColor(...C.line); doc.setLineWidth(0.2); doc.line(PAGE.m, 12, PAGE.w - PAGE.m, 12); }
  }
  const blob = doc.output('blob');
  if (deliverIt) await deliver(blob, filename, share);
  return blob;
}

function fit(doc, s, w) { s = String(s || ''); while (s.length > 4 && doc.getTextWidth(s) > w) s = s.slice(0, -2); return s; }

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/* Save a file. iPhone/iPad: the share sheet (Save to Files, WhatsApp, Print…). Elsewhere: a normal download.
   Returns 'shared' | 'downloaded' | 'cancelled'; throws {name:'NotAllowedError'} when iOS needs a fresh tap. */
export async function deliver(blob, filename, share = true) {
  const file = new File([blob], filename, { type: blob.type || 'application/pdf' });
  if (share && isIOS() && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; if (e && e.name === 'NotAllowedError') throw e; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
  return 'downloaded';
}
