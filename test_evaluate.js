const http = require('http');

const payload = {
  question: 'How does the concept of mercantilism influence the economic policies of European nations during the Age of Exploration?',
  answer: 'National wealth depended on a favorable balance of trade and the accumulation of gold and silver. This theory drove European nations to establish overseas colonies to serve as exclusive sources of raw materials and captive markets for finished goods.'
};

const data = JSON.stringify(payload);
const port = Number(process.env.PORT || 5000);
const opts = {
  hostname: 'localhost',
  port,
  path: '/api/evaluate',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(opts, (res) => {
  let body = '';
  res.on('data', (c) => body += c.toString());
  res.on('end', () => {
    console.log('STATUS', res.statusCode);
    console.log('BODY', body);
    process.exit(0);
  });
});

req.on('error', (e) => {
  console.error('REQUEST ERROR', e.message || e);
  process.exit(2);
});

req.write(data);
req.end();
