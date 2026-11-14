// File naming: {label}_{cardN}_{YYYYMMDD}.{ext}, e.g. Sharma_card1_20261027.png

export function cleanLabel(raw) {
  return (raw || '').normalize('NFKD').replace(/[^A-Za-z0-9-]/g, '');
}

export function dateStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export function cardFileName(label, cardNumber, ext, d) {
  return `${cleanLabel(label)}_card${cardNumber}_${dateStamp(d)}.${ext}`;
}

export function backFileName(label, ext, d) {
  return `${cleanLabel(label)}_back_${dateStamp(d)}.${ext}`;
}

export function zipFileName(label, d) {
  return `${cleanLabel(label)}_cards_${dateStamp(d)}.zip`;
}
