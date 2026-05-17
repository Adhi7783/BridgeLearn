const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const DB = path.join(__dirname, '..', '..', 'data', 'bridgelearn.db');
const db = new sqlite3.Database(DB);

const studentCandidates = ['student-08-01','Student 8-1','BRIDGE-08-01','BRIDGE-08-1','BRIDGE-08-01'.toLowerCase()];

function q(sql, params=[]) { return new Promise((res, rej) => db.all(sql, params, (e,r) => e ? rej(e) : res(r))); }

(async ()=>{
  try {
    console.log('DB:', DB);
    const curricula = await q("SELECT id, filename, classname, metadata FROM curricula WHERE classname LIKE '%Computer Vision%' OR filename LIKE '%Computer Vision%' OR metadata LIKE '%Computer Vision%'");
    console.log('Found curricula matching Computer Vision:', curricula.length);
    for (const c of curricula) {
      console.log('--- Curriculum ---');
      console.log('id:', c.id, 'classname:', c.classname, 'filename:', c.filename);
      let meta = {};
      try { meta = JSON.parse(c.metadata || '{}'); } catch(e){ meta = {} }
      console.log('metadata sample keys:', Object.keys(meta).slice(0,10));

      const sessions = await q('SELECT id, startTime, endTime, metadata FROM sessions WHERE curriculumId = ? ORDER BY created_at DESC LIMIT 10', [c.id]);
      console.log('sessions for curriculum:', sessions.length);
      for (const s of sessions) {
        console.log(' session id:', s.id, 'endTime:', s.endTime || null);
        const prog = await q('SELECT DISTINCT studentId FROM progress WHERE sessionId = ? LIMIT 10', [s.id]);
        console.log('  progress studentIds:', prog.map(x=>x.studentId).slice(0,10));
        const enrolls = await q('SELECT studentKey, studentName, studentCode, curriculumId FROM enrollments WHERE curriculumId = ?', [c.id]);
        console.log('  enrollments:', enrolls.length, enrolls.slice(0,10));

        for (const cand of studentCandidates) {
          const pcount = await q('SELECT COUNT(*) as cnt FROM progress WHERE sessionId = ? AND lower(trim(studentId)) = lower(trim(?))', [s.id, cand]);
          if (pcount && pcount[0] && pcount[0].cnt>0) console.log(`   progress for candidate ${cand}: ${pcount[0].cnt}`);
        }
      }
    }

    // Also show enrollments for Student 8-1
    const enrollsForStudent = await q("SELECT * FROM enrollments WHERE lower(trim(studentKey)) LIKE '%bridge-08-01%' OR lower(trim(studentCode)) LIKE '%bridge-08-01%' OR lower(trim(studentName)) LIKE '%student 8-1%' LIMIT 20");
    console.log('Enrollments matching Student 8-1:', enrollsForStudent.length);
    console.log(enrollsForStudent);

    // Show latest completed session per curriculum
    const comp = await q('SELECT id, curriculumId, endTime FROM sessions WHERE endTime IS NOT NULL ORDER BY endTime DESC LIMIT 20');
    console.log('Recent completed sessions count:', comp.length);

    db.close();
  } catch (e) {
    console.error('ERR', e);
    db.close();
  }
})();
