const sqlite3 = require('sqlite3').verbose();
const dbPath = '../data/bridgelearn.db';
const db = new sqlite3.Database(dbPath);
const q = `SELECT id, filename, metadata FROM curricula WHERE metadata LIKE '%Computer%' OR filename LIKE '%Computer%' OR metadata LIKE '%Computer Vision%'`;
db.all(q, [], (err, rows) => {
  if (err) { console.error(err); process.exit(1); }
  console.log('Found', rows.length, 'rows');
  rows.forEach((r) => {
    let meta = r.metadata;
    try { meta = JSON.parse(r.metadata); } catch (e) {}
    console.log('ID:', r.id);
    console.log('Filename:', r.filename);
    console.log('Classname:', meta?.classname || '(no classname)');
    console.log('Extracted present:', !!meta?.extracted, 'ExtractedText present:', !!meta?.extractedText);
    if (meta?.extracted) console.log('Extracted snippet:', String(meta.extracted).slice(0,200));
    console.log('---');
  });
  db.close();
});
