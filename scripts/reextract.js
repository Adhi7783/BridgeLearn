const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { PDFParse } = require('pdf-parse');
const modelManager = require('../src/modelManager');

async function analyzePdf(filePath) {
  const pdfBuffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: pdfBuffer });
  const data = await parser.getText();
  return { text: (data.text || '').trim(), pageCount: Number(data.numpages || data.total || 0) };
}

async function reextract(curriculumId) {
  const db = new sqlite3.Database(path.join(__dirname, '..', '..', 'data', 'bridgelearn.db'));
  db.get('SELECT id, filename, metadata FROM curricula WHERE id = ?', [curriculumId], async (err, row) => {
    if (err) {
      console.error('DB error:', err);
      db.close();
      return;
    }
    if (!row) {
      console.error('Curriculum not found:', curriculumId);
      db.close();
      return;
    }
    let metadata = {};
    try { metadata = JSON.parse(row.metadata || '{}'); } catch (e) { metadata = { original: row.metadata }; }
    const filename = row.filename;
    const uploadPath = path.join(__dirname, '..', '..', 'data', 'uploads', filename);
    if (!fs.existsSync(uploadPath)) {
      console.error('Uploaded file not found at', uploadPath);
      db.close();
      return;
    }
    try {
      const { text, pageCount } = await analyzePdf(uploadPath);
      const textToUse = text && text.length > 100 ? text : (metadata.extractedText || '');
      if (!textToUse || textToUse.length < 100) {
        console.error('Not enough text extracted from PDF to run extraction');
        db.close();
        return;
      }

      const extractionPrompt = `You are a JSON extraction assistant. Your response MUST be ONLY valid JSON, no other text.

Extract from this text and return ONLY this JSON structure:
{
  "title": "extracted title",
  "objectives": ["objective 1", "objective 2", "objective 3"],
  "vocabulary": ["term1", "term2", "term3", "term4", "term5"],
  "outline": [{"section": "section name", "bullets": ["point 1", "point 2"]}]
}

TEXT TO EXTRACT FROM:
${String(textToUse).substring(0, 3000)}`;

      console.log('Running model extraction (this may take a while)...');
      const extractionRaw = await modelManager.generateLocalRawWithRetry({ prompt: extractionPrompt, temperature: 0.0, maxTokens: 1200, attempts: 4, initialDelay: 2000 });
      console.log('Model returned extraction (first 300 chars):', String(extractionRaw).substring(0,300));

      metadata.extracted = extractionRaw;
      metadata.extractionStatus = 'complete';
      const metadataStr = JSON.stringify(metadata);

      db.run('UPDATE curricula SET metadata = ? WHERE id = ?', [metadataStr, curriculumId], function(updateErr) {
        if (updateErr) console.error('Failed to update DB:', updateErr);
        else console.log('Updated curriculum metadata for', curriculumId);
        db.close();
      });
    } catch (e) {
      console.error('Extraction failed:', e.message || e);
      db.close();
    }
  });
}

const id = process.argv[2];
if (!id) {
  console.error('Usage: node reextract.js <curriculumId>');
  process.exit(1);
}

reextract(id).catch((e) => { console.error(e); process.exit(1); });
