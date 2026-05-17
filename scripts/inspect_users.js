const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(path.join(__dirname, '..', '..', 'data', 'bridgelearn.db'));

db.all('SELECT id, role, name, email, status, created_at FROM users ORDER BY created_at DESC', [], (err, rows) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(JSON.stringify(rows, null, 2));
  db.close();
});
