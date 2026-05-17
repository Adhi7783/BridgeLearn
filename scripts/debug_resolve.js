const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const DB = path.join(__dirname, '..', '..', 'data', 'bridgelearn.db');
const db = new sqlite3.Database(DB);

const sessionId = process.argv[2] || 's-57b765f6-8ea4-4950-a45c-b9c57abb15c2';
const studentId = process.argv[3] || 'student-08-01';
const studentCode = process.argv[4] || 'BRIDGE-08-01';

function getSession(sid) { return new Promise((res, rej) => db.get('SELECT * FROM sessions WHERE id = ?', [sid], (e,r)=> e?rej(e):res(r))); }
function getEnrollmentByCode(currId, code) { return new Promise((res, rej) => db.get('SELECT studentName, studentCode, studentKey FROM enrollments WHERE curriculumId = ? AND lower(trim(coalesce(studentCode, \'\'))) = lower(trim(?)) ORDER BY created_at DESC LIMIT 1', [currId, code], (e,r)=> e?rej(e):res(r))); }
function getLatestCompletedSessionForCurr(currId) { return new Promise((res, rej) => db.get('SELECT id FROM sessions WHERE curriculumId = ? AND endTime IS NOT NULL ORDER BY endTime DESC LIMIT 1', [currId], (e,r)=> e?rej(e):res(r))); }
function progressExists(sessionId, candidate) { return new Promise((res, rej) => db.get('SELECT 1 as exists_flag FROM progress WHERE sessionId = ? AND lower(trim(studentId)) = lower(trim(?)) LIMIT 1', [sessionId, candidate], (e,r)=> e?rej(e):res(!!r))); }
function progressDistinctIds(sessionId) { return new Promise((res, rej) => db.all('SELECT DISTINCT studentId FROM progress WHERE sessionId = ?', [sessionId], (e,r)=> e?rej(e):res(r.map(x=>x.studentId)))); }

(async ()=>{
  try{
    const session = await getSession(sessionId);
    console.log('session:', session && session.curriculumId);
    const curr = session.curriculumId;
    const enrollmentByCode = await getEnrollmentByCode(curr, studentCode);
    console.log('enrollmentByCode:', enrollmentByCode);
    const completed = await getLatestCompletedSessionForCurr(curr);
    console.log('latestCompletedSession:', completed);
    if (completed && completed.id) {
      const candidates = [studentId];
      if (enrollmentByCode) {
        candidates.push(enrollmentByCode.studentKey, enrollmentByCode.studentCode, enrollmentByCode.studentName);
      }
      console.log('candidates:', candidates);
      for (const c of candidates) {
        const exists = await progressExists(completed.id, c);
        console.log('progressExists for', c, exists);
      }
      const allp = await progressDistinctIds(completed.id);
      console.log('all progress ids:', allp);
      const frag = String(studentId).match(/(\d{2}[-_]?\d{2})/);
      console.log('incoming fragment:', frag && frag[1]);
      if (frag && frag[1]){
        for (const p of allp) {
          const m = String(p).match(/(\d{2}[-_]?\d{2})/);
          console.log('pid',p,'frag',m && m[1]);
        }
      }
    }
    db.close();
  }catch(e){ console.error(e); db.close(); }
})();
