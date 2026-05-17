const http = require('http');

const data = JSON.stringify({
  prompt: ' Using topic "Grade 8 Social Studies" and this class context: Write a diagnostic question that a student must think carefully about. The question should reference specific concepts or techniques from the curriculum. Avoid generic wording. Be technical and specific. One question only.\n\nFINAL_OUTPUT_ONLY: Output exactly ONE question sentence and NOTHING ELSE. Do NOT include analysis, step-by-step reasoning, numbered lists, or any preamble. The output must be a single question ending with a question mark.',
  temperature: 0.09,
  maxTokens: 150,
  questionNumber: 1
});

const opts = {
  hostname: 'localhost',
  port: Number(process.env.PORT || 5001),
  path: '/api/chat',
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
    try {
      const parsed = JSON.parse(body);
      console.log('BODY', JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log('BODY', body);
    }
    process.exit(0);
  });
});

req.on('error', (e) => {
  console.error('REQUEST ERROR', e.message || e);
  process.exit(2);
});

req.write(data);
req.end();
