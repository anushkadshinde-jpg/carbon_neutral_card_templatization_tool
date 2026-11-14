// Registry of output formats. To add a new one (e.g. TIFF), create a file
// exporting { id, label, ext, description, exportCard(canvas, meta) → Blob }
// and add it to this list. Nothing else needs to change.

import { pngExporter } from './png.js';
import { pdfExporter } from './pdf.js';

export const EXPORTERS = [pngExporter, pdfExporter];
export const DEFAULT_EXPORTER = 'png';

export const getExporter = (id) => EXPORTERS.find((e) => e.id === id);
