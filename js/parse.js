/**
 * parse.js
 * Parsing file Excel skema incentive (format sama seperti contoh) menjadi
 * struktur schema.json yang dipakai kalkulator (index.html).
 *
 * Dipakai di browser (admin.html), membutuhkan library SheetJS (window.XLSX).
 *
 * Format sheet yang diharapkan (nama sheet tidak case-sensitive, boleh beda spasi):
 *  - "Incentive Schema": kolom Week | STATUS | TEAM | PRODUCT | TH 0 | TH 1 | TH 2 | TH 3 | TH 4 (dst, jumlah TH bebas)
 *  - "Threshold": kolom ISO Week | Team | Threshold (TH 0/TH 1/..) | % Ach >=
 *  - "Target Agent" (opsional): kolom ISO Week | Team | Target/Agent/Week  -> dipakai sbg default target (agent tetap bisa override)
 */

function normalizeHeader(h) {
  return String(h || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function normalizeThresholdKey(raw) {
  // "TH 0" / "TH0" / "th 4" -> "TH0".."TH4"
  const m = String(raw || '').trim().toUpperCase().match(/TH\s*(\d+)/);
  return m ? `TH${m[1]}` : null;
}

function findSheetName(workbook, candidates) {
  const names = workbook.SheetNames;
  for (const cand of candidates) {
    const found = names.find((n) => normalizeHeader(n) === normalizeHeader(cand));
    if (found) return found;
  }
  // fallback: partial match
  for (const cand of candidates) {
    const found = names.find((n) => normalizeHeader(n).includes(normalizeHeader(cand)));
    if (found) return found;
  }
  return null;
}

function sheetToRows(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
}

/**
 * @param {Object} workbook - hasil XLSX.read()
 * @param {Object} opts
 * @param {string} opts.statusFilter - hanya baris dengan STATUS ini yang dipakai (default 'Agent'). null = tidak difilter.
 * @returns {Object} schema
 */
function buildSchemaFromWorkbook(workbook, opts = {}) {
  const statusFilter = opts.statusFilter === undefined ? 'AGENT' : (opts.statusFilter ? opts.statusFilter.toUpperCase() : null);

  const incentiveSheetName = findSheetName(workbook, ['Incentive Schema', 'Incentive_Schema', 'Schema']);
  const thresholdSheetName = findSheetName(workbook, ['Threshold']);
  const targetSheetName = findSheetName(workbook, ['Target Agent', 'Target']);

  if (!incentiveSheetName) {
    throw new Error('Sheet "Incentive Schema" tidak ditemukan di file ini.');
  }

  const incentiveRows = sheetToRows(workbook, incentiveSheetName);
  const thresholdRows = thresholdSheetName ? sheetToRows(workbook, thresholdSheetName) : [];
  const targetRows = targetSheetName ? sheetToRows(workbook, targetSheetName) : [];

  if (incentiveRows.length === 0) {
    throw new Error('Sheet "Incentive Schema" kosong.');
  }

  // Deteksi kolom TH dari header baris pertama
  const headerKeys = Object.keys(incentiveRows[0]);
  const thColumns = headerKeys
    .map((h) => ({ raw: h, key: normalizeThresholdKey(h) }))
    .filter((h) => h.key !== null);

  if (thColumns.length === 0) {
    throw new Error('Tidak ditemukan kolom threshold (TH 0, TH 1, dst) di sheet "Incentive Schema".');
  }

  // cari nama kolom Week/Status/Team/Product (toleran variasi nama)
  function findCol(candidates) {
    for (const h of headerKeys) {
      const nh = normalizeHeader(h);
      if (candidates.some((c) => nh === normalizeHeader(c))) return h;
    }
    return null;
  }
  const colWeek = findCol(['Week', 'ISO Week']);
  const colStatus = findCol(['STATUS', 'Status']);
  const colTeam = findCol(['TEAM', 'Team']);
  const colProduct = findCol(['PRODUCT', 'Product']);

  if (!colWeek || !colTeam || !colProduct) {
    throw new Error('Kolom Week/Team/Product tidak lengkap di sheet "Incentive Schema".');
  }

  const weeks = {};

  for (const row of incentiveRows) {
    if (colStatus && statusFilter) {
      const statusVal = String(row[colStatus] || '').trim().toUpperCase();
      if (statusVal !== statusFilter) continue;
    }
    const week = String(row[colWeek]).trim();
    const team = String(row[colTeam]).trim();
    const product = String(row[colProduct]).trim();
    if (!week || !team || !product) continue;

    if (!weeks[week]) weeks[week] = { teams: {} };
    if (!weeks[week].teams[team]) {
      weeks[week].teams[team] = { thresholds: null, products: {}, defaultTarget: null };
    }

    const rates = {};
    for (const th of thColumns) {
      const v = row[th.raw];
      rates[th.key] = typeof v === 'number' ? v : parseFloat(v) || 0;
    }
    weeks[week].teams[team].products[product] = rates;
  }

  // Isi thresholds (cutoff %) dari sheet Threshold, kalau ada
  if (thresholdRows.length > 0) {
    const tHeaderKeys = Object.keys(thresholdRows[0]);
    function findTCol(candidates) {
      for (const h of tHeaderKeys) {
        const nh = normalizeHeader(h);
        if (candidates.some((c) => nh === normalizeHeader(c))) return h;
      }
      return null;
    }
    const tColWeek = findTCol(['ISO Week', 'Week']);
    const tColTeam = findTCol(['Team', 'TEAM']);
    const tColThreshold = findTCol(['Threshold (TH)', 'Threshold']);
    const tColCutoff = findTCol(['% Ach >=', '% Ach>=', 'Ach >=', 'Cutoff']);

    if (tColWeek && tColTeam && tColThreshold && tColCutoff) {
      for (const row of thresholdRows) {
        const week = String(row[tColWeek]).trim();
        const team = String(row[tColTeam]).trim();
        const key = normalizeThresholdKey(row[tColThreshold]);
        const cutoff = typeof row[tColCutoff] === 'number' ? row[tColCutoff] : parseFloat(row[tColCutoff]);
        if (!week || !team || !key || Number.isNaN(cutoff)) continue;
        if (!weeks[week] || !weeks[week].teams[team]) continue;
        if (!weeks[week].teams[team].thresholds) weeks[week].teams[team].thresholds = [];
        weeks[week].teams[team].thresholds.push({ key, cutoff });
      }
    }
  }

  // Default thresholds kalau sheet Threshold tidak ada / tidak lengkap:
  // ambil dari kolom TH yang terdeteksi, asumsikan urutan standar 0%,50%,75%,100%,125%,...
  const DEFAULT_CUTOFFS = [0, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  for (const week of Object.keys(weeks)) {
    for (const team of Object.keys(weeks[week].teams)) {
      const teamData = weeks[week].teams[team];
      if (!teamData.thresholds || teamData.thresholds.length === 0) {
        teamData.thresholds = thColumns.map((th, i) => ({
          key: th.key,
          cutoff: DEFAULT_CUTOFFS[i] !== undefined ? DEFAULT_CUTOFFS[i] : i * 0.25,
        }));
      } else {
        // dedupe & sort
        const seen = new Map();
        for (const t of teamData.thresholds) seen.set(t.key, t.cutoff);
        teamData.thresholds = [...seen.entries()].map(([key, cutoff]) => ({ key, cutoff }))
          .sort((a, b) => a.cutoff - b.cutoff);
      }
    }
  }

  // Isi defaultTarget dari sheet Target Agent, kalau ada
  if (targetRows.length > 0) {
    const gHeaderKeys = Object.keys(targetRows[0]);
    function findGCol(candidates) {
      for (const h of gHeaderKeys) {
        const nh = normalizeHeader(h);
        if (candidates.some((c) => nh === normalizeHeader(c))) return h;
      }
      return null;
    }
    const gColWeek = findGCol(['ISO Week', 'Week']);
    const gColTeam = findGCol(['Team', 'TEAM']);
    const gColTarget = findGCol(['Target/Agent/Week', 'Target']);
    if (gColWeek && gColTeam && gColTarget) {
      for (const row of targetRows) {
        const week = String(row[gColWeek]).trim();
        const team = String(row[gColTeam]).trim();
        const target = typeof row[gColTarget] === 'number' ? row[gColTarget] : parseFloat(row[gColTarget]);
        if (!week || !team || Number.isNaN(target)) continue;
        if (!weeks[week] || !weeks[week].teams[team]) continue;
        weeks[week].teams[team].defaultTarget = target;
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    weeks,
  };
}
