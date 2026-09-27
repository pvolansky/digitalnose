import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { journalResidents } from './domain/journal';
import type { SmellReport } from './domain/types';

export type JournalPdfOptions = {
  siteName: string;
  timezone: string;
  from: string;
  to: string;
  residentLabel: string;
  reports: SmellReport[];
  residents?: ReturnType<typeof journalResidents>;
  demo?: boolean;
};
const clean = (value: string) =>
  value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').normalize('NFC');

export function createJournalPdf(options: JournalPdfOptions, fontBase64: string) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('NotoSans-Regular.ttf', fontBase64);
  doc.addFont('NotoSans-Regular.ttf', 'Journal', 'normal');
  doc.setFont('Journal', 'normal');
  doc.setProperties({ title: 'Digital Nose - Smell journal', author: 'Digital Nose' });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  doc.setTextColor(28, 48, 46);
  doc.setFontSize(21);
  doc.text(options.demo ? 'Smell journal - demo' : 'Smell journal', 14, 20);
  doc.setFontSize(10);
  const intro = [
    clean(options.siteName),
    `${options.from} to ${options.to} (inclusive) | ${options.timezone}`,
    `Resident: ${clean(options.residentLabel)} | ${options.reports.length} ${options.reports.length === 1 ? 'observation' : 'observations'}`,
    options.demo
      ? 'Illustrative observations from fictional residents.'
      : 'Resident observations as recorded. Times use the site timezone.',
  ].flatMap((line) => doc.splitTextToSize(line, width - 28) as string[]);
  doc.text(intro, 14, 29, { lineHeightFactor: 1.5 });
  const labels = new Map(
    (options.residents || journalResidents(options.reports)).map((r) => [r.id, r.label]),
  );
  autoTable(doc, {
    startY: 33 + intro.length * 5.3,
    margin: { top: 18, right: 14, bottom: 17, left: 14 },
    head: [['Date / time', 'Resident', 'Smell type', 'Intensity', 'Notes']],
    body: [...options.reports]
      .sort((a, b) => a.reported_at.localeCompare(b.reported_at) || a.id.localeCompare(b.id))
      .map((r) => [
        new Intl.DateTimeFormat('en-GB', {
          timeZone: options.timezone,
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZoneName: 'short',
        }).format(new Date(r.reported_at)),
        clean(labels.get(r.user_id) || 'Resident'),
        clean(r.smell_type || 'Not specified'),
        `${r.intensity} / 5`,
        clean(r.note || '-'),
      ]),
    styles: {
      font: 'Journal',
      fontStyle: 'normal',
      fontSize: 9,
      cellPadding: 3,
      overflow: 'linebreak',
      valign: 'top',
      textColor: [35, 47, 46],
      lineColor: [218, 226, 224],
      lineWidth: 0.15,
    },
    headStyles: { fontStyle: 'normal', fillColor: [32, 78, 67], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [244, 248, 246] },
    columnStyles: {
      0: { cellWidth: 43 },
      1: { cellWidth: 39 },
      2: { cellWidth: 32 },
      3: { cellWidth: 22 },
      4: { cellWidth: 'auto' },
    },
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont('Journal', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(95, 109, 104);
    if (page > 1) doc.text('Digital Nose | Smell journal', 14, 11);
    doc.text('Digital Nose | Resident observations', 14, height - 8);
    doc.text(`Page ${page} of ${pages}`, width - 14, height - 8, { align: 'right' });
  }
  return doc;
}

export async function journalPdfBlob(options: JournalPdfOptions) {
  const response = await fetch('/fonts/NotoSans-Regular.ttf');
  if (!response.ok) throw new Error('Unable to load the report font. Please try again.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const doc = createJournalPdf(options, btoa(binary));
  return doc.output('blob');
}
