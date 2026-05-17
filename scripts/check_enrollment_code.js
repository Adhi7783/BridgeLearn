const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const DB = path.join(__dirname, '..', '..', 'data', 'bridgelearn.db');
const db = new sqlite3.Database(DB);
const cur = 'c-ff095da8-088a-45c4-a27c-5f82df48f915';
const code = 'BRIDGE-08-01';

db.get('SELECT * FROM enrollments WHERE curriculumId = ? AND lower(trim(coalesce(studentCode, \'\'))) = lower(trim(?)) LIMIT 1', [cur, code], (err, row) => {
  if (err) console.error('ERR', err);
  else console.log('ENROLL_BY_CODE:', row);
  db.close();
});
