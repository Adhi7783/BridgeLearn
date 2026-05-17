const path = require('path');
const fs = require('fs');
const pdfparse = require('pdf-parse');
const dataManager = require('../src/dataManager');
const modelManager = require('../src/modelManager');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

function looksGenericExtract(text) {
  if (!text || typeof text !== 'string') return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.length < 120) return true;
  const genericRegex = /\b(start with the|main idea|key idea|important concept|think about how|consider how|try relating|try relating|try to relate)\b/i;
  if (genericRegex.test(trimmed)) return true;
  return false;
}

async function analyzePdf(filePath) {
  const data = fs.readFileSync(filePath);
  const parsed = await pdfparse(data);
  return { text: (parsed.text || '').trim(), pageCount: Number(parsed.numpages || parsed.numpages || 0) };
}

async function reextractOne(row) {
  try {
    const id = row.id;
    const filename = row.filename;
    let metadata = {};
    try { metadata = row.metadata ? JSON.parse(row.metadata) : {}; } catch (e) { metadata = {}; }

    const existing = metadata.extracted || '';
    if (!looksGenericExtract(existing)) {
      console.log(`[SKIP] ${id} - has non-generic extracted (len=${String(existing).length})`);
      return { id, status: 'skipped' };
    }

    console.log(`[PROCESS] ${id} - regenerating extract...`);

    let textToExtract = metadata.extractedText || '';
    if (!textToExtract && filename) {
      const uploadedPath = path.join(UPLOADS_DIR, filename);
      if (fs.existsSync(uploadedPath)) {
        const analyzed = await analyzePdf(uploadedPath);
        textToExtract = analyzed.text || '';
      } else {
        console.warn(`[WARN] Uploaded file missing for ${id}: ${uploadedPath}`);
      }
    }

    if (!textToExtract || textToExtract.length < 120) {
      console.warn(`[FAIL] ${id} - not enough source text (${(textToExtract||'').length} chars)`);
      return { id, status: 'no-source' };
    }

    const extractionPrompt = `You are a JSON extraction assistant. Your response MUST be ONLY valid JSON, no other text.\n\nExtract from this text and return ONLY this JSON structure:\n{\n  "title": "extracted title",\n  "objectives": ["objective 1", "objective 2", "objective 3"],\n  "vocabulary": ["term1", "term2", "term3", "term4", "term5"],\n  "outline": [{"section": "section name", "bullets": ["point 1", "point 2"]}]\n}\n\nTEXT TO EXTRACT FROM:\n${String(textToExtract).substring(0, 3000)}`;

    const extractionRaw = await modelManager.generateLocalRawWithRetry({ prompt: extractionPrompt, temperature: 0.0, maxTokens: 1200, attempts: 4, initialDelay: 2000 });

    metadata.extracted = extractionRaw;
    metadata.extractionStatus = 'complete';
    await dataManager.updateCurriculum(id, metadata);

    console.log(`[OK] ${id} - updated metadata.extracted (len=${String(extractionRaw||'').length})`);
    return { id, status: 'updated' };
  } catch (err) {
    console.error(`[ERR] ${row.id} - ${err.message || err}`);
    return { id: row.id, status: 'error', error: err.message || String(err) };
  }
}

async function run() {
  console.log('Batch re-extract starting...');
  const db = dataManager.db;
  db.all(`SELECT id, filename, metadata FROM curricula ORDER BY created_at DESC`, async (err, rows) => {
    if (err) {
      console.error('Failed to read curricula:', err.message || err);
      process.exit(1);
    }

    const candidates = rows || [];
    console.log(`Found ${candidates.length} curricula; scanning for generic extracts...`);

    const results = [];
    for (const row of candidates) {
      // sequential to avoid model overload
      // small delay between requests
      const r = await reextractOne(row);
      results.push(r);
      await new Promise((r2) => setTimeout(r2, 800));
    }

    const summary = results.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});

    console.log('Batch re-extract complete. Summary:', summary);
    process.exit(0);
  });
}

run().catch((e) => { console.error(e); process.exit(1); });
