const http = require('http');
const data = JSON.stringify({ sessionId: 'test-session-1', studentId: 'Alice|BRIDGE-01', grade: '8', subject: 'Biology' });

const portsToTry = [3000, 5000];

let tried = 0;

function tryPort(port) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: port,
      path: '/api/session/next',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', (c) => body += c.toString());
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (e) => reject(e));
    req.write(data);
    req.end();
  });
}

;(async () => {
  for (const p of portsToTry) {
    tried++;
    try {
      const r = await tryPort(p);
      console.log('STATUS', r.status);
      try { console.log('BODY', JSON.parse(r.body)); } catch (e) { console.log('BODY', r.body); }
      process.exit(0);
    } catch (e) {
      console.error('PORT', p, 'error:', e.message || e);
    }
  }
  console.error('All ports tried and failed');
  process.exit(2);
})();
