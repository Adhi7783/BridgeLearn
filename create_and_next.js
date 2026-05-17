const http = require('http');

function postJson(path, obj, port=5000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(obj);
    const opts = {
      hostname: 'localhost',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', c => body += c.toString());
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
      });
    });
    req.on('error', e => reject(e));
    req.write(data);
    req.end();
  });
}

(async () => {
  try {
    const port = Number(process.env.PORT || 5000);
    console.log('Creating session...');
    const create = await postJson('/api/session/create', { title: 'Test Session', curriculumId: null, startTime: Date.now() }, port);
    console.log('Create response:', create);
    const sessionId = create?.session?.id || create?.id || null;
    if (!sessionId) {
      console.error('Failed to create session'); process.exit(2);
    }
    console.log('Requesting next question for session', sessionId);
    const next = await postJson('/api/session/next', { sessionId, studentId: 'Alice|BRIDGE-01', grade: '8', subject: 'Biology' }, port);
    console.log('Next response:', next);
  } catch (e) {
    console.error('Error', e.message || e);
    process.exit(3);
  }
})();
