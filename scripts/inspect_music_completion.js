const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', '..', 'data', 'bridgelearn.db');
const db = new sqlite3.Database(dbPath);

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

(async () => {
  try {
    const enrollments = await all(
      `SELECT id, studentName, studentCode, studentKey, curriculumId, teacherId, classname, created_at
       FROM enrollments
       WHERE lower(trim(studentName)) LIKE '%student 8-01%'
          OR lower(trim(studentKey)) LIKE '%bridge-08-01%'
          OR lower(trim(studentCode)) LIKE '%bridge-08-01%'
       ORDER BY created_at DESC`
    );
    console.log('ENROLLMENTS_08_01');
    console.log(JSON.stringify(enrollments, null, 2));

    const curricula = await all(
      `SELECT id, classname, filename, teacherId, created_at, metadata
       FROM curricula
       WHERE lower(trim(classname)) LIKE '%music%'
       ORDER BY created_at DESC`
    );
    const parsedCurricula = curricula.map((row) => {
      let metadata = {};
      try { metadata = row.metadata ? JSON.parse(row.metadata) : {}; } catch (e) {}
      return {
        id: row.id,
        classname: row.classname,
        teacherId: row.teacherId,
        created_at: row.created_at,
        subject: metadata.subject || null
      };
    });
    console.log('CURRICULA_MUSIC');
    console.log(JSON.stringify(parsedCurricula, null, 2));

    const grade8Music = curricula.find((row) => String(row.classname || '').trim() === 'Grade 8 Music');
    if (!grade8Music) {
      console.log('NO_GRADE8_MUSIC');
      return;
    }

    const sessions = await all(
      `SELECT s.id, s.curriculumId, s.startTime, s.endTime, s.created_at,
              COUNT(DISTINCT q.id) AS questionCount,
              COUNT(DISTINCT p.id) AS progressCount
       FROM sessions s
       LEFT JOIN questions q ON q.sessionId = s.id
       LEFT JOIN progress p ON p.sessionId = s.id
       WHERE s.curriculumId = ?
       GROUP BY s.id
       ORDER BY COALESCE(s.endTime, s.created_at) DESC
       LIMIT 20`,
      [grade8Music.id]
    );
    console.log('SESSIONS_GRADE8_MUSIC');
    console.log(JSON.stringify(sessions, null, 2));

    for (const session of sessions.slice(0, 10)) {
      const progressRows = await all(
        `SELECT DISTINCT studentId FROM progress WHERE sessionId = ? ORDER BY studentId`,
        [session.id]
      );
      const questionRows = await all(
        `SELECT questionId, text FROM questions WHERE sessionId = ? ORDER BY created_at ASC`,
        [session.id]
      );
      console.log('SESSION_DETAIL', session.id);
      console.log(JSON.stringify({
        studentIds: progressRows.map((row) => row.studentId),
        questions: questionRows.length,
        firstQuestion: questionRows[0]?.text || null
      }, null, 2));
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();
