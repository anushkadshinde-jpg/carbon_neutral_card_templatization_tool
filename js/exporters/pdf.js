// PDF exporter: one single-page PDF per card, page size = trim size.

import { loadScript, canvasToBlob } from '../util.js';

export const pdfExporter = {
  id: 'pdf',
  label: 'PDF',
  ext: 'pdf',
  description: 'For vendors that prefer PDF. One single-page PDF per card at 2.5 × 3.5 in.',
  async exportCard(canvas, { widthIn, heightIn, title }) {
    await loadScript('vendor/jspdf.umd.min.js');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'in', format: [widthIn, heightIn], orientation: 'portrait', compress: true });
    doc.setProperties({ title, creator: '14 Trees card tool' });
    // Lossless PNG so the PDF matches the preview pixel-for-pixel.
    const png = new Uint8Array(await (await canvasToBlob(canvas, 'image/png')).arrayBuffer());
    doc.addImage(png, 'PNG', 0, 0, widthIn, heightIn, undefined, 'FAST');
    return doc.output('blob');
  },
};
