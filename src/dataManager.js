const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'bridgelearn.db');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

class DataManager {
  constructor() {
    ensureDataDir();
    this.db = new sqlite3.Database(DB_PATH);
    this._init();
  }

  _init() {
    const s = this.db;
    s.serialize(() => {
      s.run(`CREATE TABLE IF NOT EXISTS curricula (
        id TEXT PRIMARY KEY,
        filename TEXT,
        metadata TEXT,
        teacherId TEXT,
        classname TEXT,
        created_at INTEGER
      )`);

      // Ensure new columns exist (safe for migration)
      s.run(`ALTER TABLE curricula ADD COLUMN teacherId TEXT`, (err) => {
        // Column may already exist, ignore error
      });
      s.run(`ALTER TABLE curricula ADD COLUMN classname TEXT`, (err) => {
        // Column may already exist, ignore error
      });

      s.run(`CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        curriculumId TEXT,
        joinCode TEXT,
        startTime INTEGER,
        endTime INTEGER,
        created_at INTEGER
      )`);

      // ensure metadata column exists for sessions (stores JSON)
      s.run(`ALTER TABLE sessions ADD COLUMN metadata TEXT`, (err) => {
        // ignore error if column already exists
      });

      s.run(`CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY,
        name TEXT,
        created_at INTEGER
      )`);

      s.run(`CREATE TABLE IF NOT EXISTS enrollments (
        id TEXT PRIMARY KEY,
        studentName TEXT,
        studentCode TEXT,
        studentKey TEXT,
        curriculumId TEXT,
        teacherId TEXT,
        classname TEXT,
        created_at INTEGER,
        UNIQUE(studentKey, curriculumId)
      )`);

      s.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        role TEXT,
        name TEXT,
        email TEXT UNIQUE,
        status TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )`);

      s.run(`CREATE TABLE IF NOT EXISTS progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId TEXT,
        studentId TEXT,
        questionId TEXT,
        answer TEXT,
        correct INTEGER,
        hintRequested INTEGER,
        timestamp INTEGER
      )`);

      s.run(`CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        sessionId TEXT,
        studentId TEXT,
        questionId TEXT,
        text TEXT,
        difficulty INTEGER,
        created_at INTEGER
      )`);

      s.run(`CREATE TABLE IF NOT EXISTS analytics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT,
        details TEXT,
        timestamp INTEGER
      )`);
    });
  }

  getCurriculum(curriculumId) {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM curricula WHERE id = ?`, [curriculumId], (err, row) => {
        if (err) return reject(err);
        if (row && row.metadata) {
          try {
            row.metadata = JSON.parse(row.metadata);
          } catch (e) {
            row.metadata = {};
          }
        }
        resolve(row || null);
      });
    });
  }

  listCurriculaByTeacher(teacherId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT id, filename, classname, metadata, teacherId, created_at FROM curricula WHERE teacherId = ? ORDER BY created_at DESC`,
        [teacherId],
        (err, rows) => {
          if (err) return reject(err);
          const result = (rows || []).map((row) => {
            if (row.metadata) {
              try {
                row.metadata = JSON.parse(row.metadata);
              } catch (e) {
                row.metadata = {};
              }
            }
            return row;
          });
          resolve(result);
        }
      );
    });
  }

  findCurriculumByClassname(classname) {
    const target = String(classname || '').trim().toLowerCase();
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM curricula ORDER BY created_at DESC`,
        [],
        (err, rows) => {
          if (err) return reject(err);
          const match = (rows || []).find((row) => {
            let metadata = {};
            try {
              metadata = row.metadata ? JSON.parse(row.metadata) : {};
            } catch (e) {
              metadata = {};
            }
            const candidates = [row.classname, row.filename, metadata.classname, metadata.title]
              .filter(Boolean)
              .map((value) => String(value).trim().toLowerCase());
            return candidates.includes(target);
          }) || null;
          if (match && match.metadata) {
            try {
              match.metadata = JSON.parse(match.metadata);
            } catch (e) {
              match.metadata = {};
            }
          }
          resolve(match);
        }
      );
    });
  }

  updateCurriculum(curriculumId, metadata) {
    return this.updateCurriculumMetadata(curriculumId, metadata);
  }

  createCurriculum({ id, filename, metadata, teacherId, classname }) {
    const created_at = Date.now();
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO curricula (id, filename, metadata, teacherId, classname, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, filename, JSON.stringify(metadata || {}), teacherId, classname || filename, created_at],
        function (err) {
          if (err) return reject(err);
          resolve({ id, filename, metadata, teacherId, classname, created_at });
        }
      );
    });
  }

  assignCurriculumToClass(curriculumId, teacherId, classname) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE enrollments SET curriculumId = ? WHERE teacherId = ? AND classname = ?`,
        [curriculumId, teacherId, classname],
        function (err) {
          if (err) return reject(err);
          resolve({ curriculumId, teacherId, classname, changes: this.changes });
        }
      );
    });
  }

  countEnrollmentsForClass(teacherId, classname) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT COUNT(*) as cnt FROM enrollments WHERE teacherId = ? AND classname = ?`,
        [teacherId, classname],
        (err, row) => {
          if (err) return reject(err);
          resolve(Number(row?.cnt || 0));
        }
      );
    });
  }

  // Backwards-compatible alias used by server upload path
  saveCurriculum({ id, filename, metadata, teacherId, classname }) {
    return this.createCurriculum({ id, filename, metadata, teacherId, classname });
  }

  updateCurriculumMetadata(curriculumId, metadata) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE curricula SET metadata = ? WHERE id = ?`,
        [JSON.stringify(metadata), curriculumId],
        function (err) {
          if (err) return reject(err);
          resolve({ id: curriculumId, metadata });
        }
      );
    });
  }

  createUser({ id, role, name, email, status }) {
    const now = Date.now();
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO users (id, role, name, email, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, role, name, email, status, now, now],
        function (err) {
          if (err) return reject(err);
          resolve({ id, role, name, email, status, created_at: now, updated_at: now });
        }
      );
    });
  }

  getUserByEmail(email) {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  }

  getUserById(userId) {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  }

  listUsers() {
    return new Promise((resolve, reject) => {
      this.db.all(`SELECT * FROM users ORDER BY created_at DESC`, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }

  updateUserStatus(userId, status) {
    const updatedAt = Date.now();
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE users SET status = ?, updated_at = ? WHERE id = ?`,
        [status, updatedAt, userId],
        function (err) {
          if (err) return reject(err);
          resolve({ id: userId, status, updated_at: updatedAt, changes: this.changes });
        }
      );
    });
  }

  deleteUser(userId) {
    return new Promise((resolve, reject) => {
      this.db.run(`DELETE FROM users WHERE id = ?`, [userId], function (err) {
        if (err) return reject(err);
        resolve({ deleted: true });
      });
    });
  }

  deleteCurriculum(curriculumId) {
    return new Promise((resolve, reject) => {
      this.db.run(`DELETE FROM curricula WHERE id = ?`, [curriculumId], function (err) {
        if (err) return reject(err);
        resolve({ deleted: true, changes: this.changes });
      });
    });
  }

  getSessionById(sessionId) {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM sessions WHERE id = ?`, [sessionId], (err, row) => {
        if (err) return reject(err);
        if (row && row.metadata) {
          try {
            row.metadata = JSON.parse(row.metadata);
          } catch (e) {
            row.metadata = {};
          }
        }
        resolve(row || null);
      });
    });
  }

  findSessionByJoinCode(joinCode) {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM sessions WHERE joinCode = ?`, [joinCode], (err, row) => {
        if (err) return reject(err);
        if (row && row.metadata) {
          try {
            row.metadata = JSON.parse(row.metadata);
          } catch (e) {
            row.metadata = {};
          }
        }
        resolve(row || null);
      });
    });
  }

  listEnrollmentsByTeacher(teacherId, curriculumId = null) {
    return new Promise((resolve, reject) => {
      const curriculumFilter = String(curriculumId || '').trim();
      const curriculumClause = curriculumFilter ? 'AND e.curriculumId = ?' : '';
      const params = curriculumFilter ? [teacherId, curriculumFilter] : [teacherId];
      this.db.all(
        `SELECT
           e.studentKey,
           e.studentName,
           e.studentCode,
           e.classname,
           e.created_at,
           c.classname AS curriculumClassname,
           c.filename AS curriculumFilename
         FROM enrollments e
         LEFT JOIN curricula c ON c.id = e.curriculumId
         WHERE e.teacherId = ?
         ${curriculumClause}
         ORDER BY e.created_at DESC`,
        params,
        (err, rows) => {
          if (err) return reject(err);
          const grouped = new Map();
          for (const row of rows || []) {
            const rawKey = row.studentKey || `${row.studentName || ''}|${row.studentCode || ''}`;
            const key = String(rawKey || '').trim().toLowerCase();
            if (!grouped.has(key)) {
              grouped.set(key, {
                studentKey: rawKey,
                studentName: row.studentName || '',
                studentCode: row.studentCode || '',
                classCount: 0,
                lastEnrolledAt: row.created_at || 0,
                classnames: []
              });
            }
            const current = grouped.get(key);
            current.classCount += 1;
            current.lastEnrolledAt = Math.max(Number(current.lastEnrolledAt || 0), Number(row.created_at || 0));
            const label = row.classname || row.curriculumClassname || row.curriculumFilename || 'Untitled class';
            if (label && !current.classnames.includes(label)) current.classnames.push(label);
          }
          resolve(Array.from(grouped.values()));
        }
      );
    });
  }

  getEnrollmentById(enrollmentId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM enrollments WHERE id = ?`,
        [enrollmentId],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || null);
        }
      );
    });
  }

  listEnrollmentsByStudent({ studentKey, studentName, studentCode } = {}) {
    const resolvedStudentKey = studentKey || `${String(studentName || '').trim()}|${String(studentCode || '').trim()}`;
    return this.getEnrollmentsByStudent(resolvedStudentKey, studentName, studentCode);
  }

  createStudent({ id, name }) {
    const created_at = Date.now();
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO students (id, name, created_at) VALUES (?, ?, ?)`,
        [id, name, created_at],
        function (err) {
          if (err) return reject(err);
          resolve({ id, name, created_at });
        }
      );
    });
  }

  enrollStudent({ studentName, studentCode, studentKey, curriculumId, teacherId, classname }) {
    const id = `e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const resolvedStudentKey = studentKey || `${String(studentName || '').trim()}|${String(studentCode || '').trim()}`;
    return this.createEnrollment({
      id,
      studentName,
      studentCode,
      studentKey: resolvedStudentKey,
      curriculumId,
      teacherId,
      classname
    });
  }

  listCurriculaWithStatus(status) {
    const target = String(status || '').trim().toLowerCase();
    return new Promise((resolve, reject) => {
      this.db.all(`SELECT * FROM curricula ORDER BY created_at DESC`, [], (err, rows) => {
        if (err) return reject(err);
        const result = (rows || []).filter((row) => {
          try {
            const metadata = row.metadata ? JSON.parse(row.metadata) : {};
            return String(metadata.extractionStatus || '').trim().toLowerCase() === target;
          } catch (e) {
            return false;
          }
        }).map((row) => {
          if (row.metadata) {
            try {
              row.metadata = JSON.parse(row.metadata);
            } catch (e) {
              row.metadata = {};
            }
          }
          return row;
        });
        resolve(result);
      });
    });
  }

  getLatestTranscriptForTeacher(teacherId, curriculumId = null) {
    return new Promise((resolve, reject) => {
      const curriculumFilter = String(curriculumId || '').trim();
      const curriculumClause = curriculumFilter ? 'AND s.curriculumId = ?' : '';
      const params = curriculumFilter ? [teacherId, curriculumFilter] : [teacherId];
      this.db.all(
        `SELECT s.*, COUNT(DISTINCT q.id) AS questionCount, COUNT(DISTINCT p.id) AS progressCount
         FROM sessions s
         LEFT JOIN curricula c ON c.id = s.curriculumId
         LEFT JOIN questions q ON q.sessionId = s.id
         LEFT JOIN progress p ON p.sessionId = s.id
         WHERE c.teacherId = ?
         ${curriculumClause}
         GROUP BY s.id
         ORDER BY CASE WHEN COUNT(DISTINCT q.id) > 0 THEN 0 WHEN COUNT(DISTINCT p.id) > 0 THEN 1 ELSE 2 END,
                  COALESCE(s.endTime, s.created_at) DESC
         LIMIT 1`,
        params,
        async (err, rows) => {
          if (err) return reject(err);
          const session = (rows || [])[0] || null;
          if (!session) return resolve({ session: null, studentId: null, studentName: null, transcript: [] });

          try { session.metadata = session.metadata ? JSON.parse(session.metadata) : {}; } catch (e) { session.metadata = {}; }
          const sessionStudentName = session.metadata?.demoStudentName || session.metadata?.studentName || null;

          const resolveStudentId = () => new Promise((resolveStudent) => {
            if (session.metadata?.demoStudentId || session.metadata?.studentId) {
              return resolveStudent(session.metadata.demoStudentId || session.metadata.studentId);
            }
            this.db.all(
              `SELECT studentId, COUNT(*) AS count
               FROM questions
               WHERE sessionId = ?
               GROUP BY studentId
               ORDER BY count DESC, MIN(created_at) ASC
               LIMIT 1`,
              [session.id],
              (questionErr, questionRows) => {
                if (!questionErr && questionRows && questionRows[0] && questionRows[0].studentId) {
                  return resolveStudent(questionRows[0].studentId);
                }
                this.db.all(
                  `SELECT DISTINCT studentId FROM progress WHERE sessionId = ? LIMIT 1`,
                  [session.id],
                  (progressErr, progressRows) => {
                    if (progressErr || !progressRows || !progressRows[0]) return resolveStudent(null);
                    resolveStudent(progressRows[0].studentId);
                  }
                );
              }
            );
          });

          const studentId = await resolveStudentId();
          const transcript = await new Promise((resolveTranscript) => {
            const query = `SELECT q.questionId, q.text as questionText, p.answer, p.correct, p.hintRequested, p.timestamp
                           FROM questions q
                           LEFT JOIN progress p ON q.sessionId = p.sessionId AND q.questionId = p.questionId
                           WHERE q.sessionId = ?
                           ORDER BY q.created_at ASC, p.timestamp ASC`;
            this.db.all(query, [session.id], (queryErr, rows) => {
              if (queryErr) return resolveTranscript([]);
              const collapsed = [];
              const indexByQuestionKey = new Map();
              for (const row of rows || []) {
                const normalizedText = String(row.questionText || '').trim().toLowerCase();
                const key = normalizedText || String(row.questionId || '').trim() || `${row.questionText || ''}-${row.timestamp || 0}`;
                if (!indexByQuestionKey.has(key)) {
                  const entry = {
                    questionId: row.questionId || null,
                    questionText: row.questionText || '',
                    answer: row.answer ?? null,
                    correct: row.correct ?? null,
                    hintRequested: row.hintRequested ?? null,
                    timestamp: row.timestamp || null
                  };
                  indexByQuestionKey.set(key, collapsed.length);
                  collapsed.push(entry);
                } else {
                  const entry = collapsed[indexByQuestionKey.get(key)];
                  if (row.answer !== null && row.answer !== undefined && String(row.answer).trim()) {
                    entry.answer = row.answer;
                  }
                  if (row.correct !== null && row.correct !== undefined) entry.correct = row.correct;
                  if (row.hintRequested !== null && row.hintRequested !== undefined) entry.hintRequested = row.hintRequested;
                  if (row.timestamp && (!entry.timestamp || Number(row.timestamp) > Number(entry.timestamp))) {
                    entry.timestamp = row.timestamp;
                  }
                }
              }

              // If no questions were stored for the session, fall back to progress rows
              // so outcome review can still show the completed interaction.
              if (!collapsed.length) {
                this.db.all(
                  `SELECT questionId, answer, correct, hintRequested, timestamp
                   FROM progress
                   WHERE sessionId = ?
                   ORDER BY timestamp ASC`,
                  [session.id],
                  (progressErr, progressRows) => {
                    if (progressErr) return resolveTranscript([]);
                    const fallbackTranscript = [];
                    const byQuestion = new Map();
                    for (const row of progressRows || []) {
                      const key = String(row.questionId || '').trim() || `progress-${fallbackTranscript.length + 1}`;
                      if (!byQuestion.has(key)) {
                        const entry = {
                          questionId: row.questionId || null,
                          questionText: row.questionId ? `Question ${row.questionId}` : `Question ${fallbackTranscript.length + 1}`,
                          answer: row.answer ?? null,
                          correct: row.correct ?? null,
                          hintRequested: row.hintRequested ?? null,
                          timestamp: row.timestamp || null
                        };
                        byQuestion.set(key, fallbackTranscript.length);
                        fallbackTranscript.push(entry);
                      } else {
                        const entry = fallbackTranscript[byQuestion.get(key)];
                        if (row.answer !== null && row.answer !== undefined && String(row.answer).trim()) entry.answer = row.answer;
                        if (row.correct !== null && row.correct !== undefined) entry.correct = row.correct;
                        if (row.hintRequested !== null && row.hintRequested !== undefined) entry.hintRequested = row.hintRequested;
                        if (row.timestamp && (!entry.timestamp || Number(row.timestamp) > Number(entry.timestamp))) entry.timestamp = row.timestamp;
                      }
                    }
                    resolveTranscript(fallbackTranscript);
                  }
                );
                return;
              }
              resolveTranscript(collapsed);
            });
          });

          resolve({ session, studentId, studentName: sessionStudentName || studentId || null, transcript });
        }
      );
    });
  }

  createSession({ id, title, curriculumId, joinCode, startTime, endTime, metadata }) {
    const created_at = Date.now();
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO sessions (id, title, curriculumId, joinCode, startTime, endTime, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, title, curriculumId, joinCode, startTime, endTime || null, created_at, JSON.stringify(metadata || {})],
        function (err) {
          if (err) return reject(err);
          resolve({ id, title, curriculumId, joinCode, startTime, endTime, created_at, metadata });
        }
      );
    });
  }

  updateSessionMetadata(sessionId, metadata) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE sessions SET metadata = ? WHERE id = ?`,
        [JSON.stringify(metadata), sessionId],
        function (err) {
          if (err) return reject(err);
          resolve({ id: sessionId, metadata });
        }
      );
    });
  }

  setSessionEndTime(sessionId, endTime = Date.now()) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE sessions SET endTime = ? WHERE id = ?`,
        [endTime, sessionId],
        (err) => {
          if (err) return reject(err);
          this.db.get(`SELECT * FROM sessions WHERE id = ?`, [sessionId], (getErr, row) => {
            if (getErr) return reject(getErr);
            resolve(row || null);
          });
        }
      );
    });
  }

  recordAnswer({ sessionId, studentId, questionId, answer, correct, hintRequested }) {
    const timestamp = Date.now();
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO progress (sessionId, studentId, questionId, answer, correct, hintRequested, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [sessionId, studentId, questionId, answer, correct ? 1 : 0, hintRequested ? 1 : 0, timestamp],
        function (err) {
          if (err) return reject(err);
          resolve({ rowId: this.lastID });
        }
      );
    });
  }

  createQuestion({ id, sessionId, studentId, questionId, text, difficulty }) {
    const created_at = Date.now();
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO questions (id, sessionId, studentId, questionId, text, difficulty, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, sessionId, studentId, questionId, text, difficulty || 2, created_at],
        function (err) {
          if (err) return reject(err);
          resolve({ id, sessionId, studentId, questionId, text, difficulty, created_at });
        }
      );
    });
  }

  getQuestionsBySessionAndStudent(sessionId, studentId) {
    return new Promise((resolve, reject) => {
      this.db.all(`SELECT * FROM questions WHERE sessionId = ? AND studentId = ? ORDER BY created_at ASC`, [sessionId, studentId], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }

  getLastAnswers(sessionId, studentId, limit = 5) {
    return new Promise((resolve, reject) => {
      this.db.all(`SELECT * FROM progress WHERE sessionId = ? AND studentId = ? ORDER BY timestamp DESC LIMIT ?`, [sessionId, studentId, limit], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }

  getTranscript(sessionId, studentId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT q.questionId, q.text as questionText, p.answer, p.correct, p.hintRequested, p.timestamp
         FROM questions q
         LEFT JOIN progress p ON q.sessionId = p.sessionId AND q.questionId = p.questionId
         WHERE q.sessionId = ?
         ORDER BY q.created_at ASC, p.timestamp ASC`,
        [sessionId],
        (err, rows) => {
          if (err) return reject(err);
          const collapsed = [];
          const indexByQuestionKey = new Map();
          for (const row of rows || []) {
            const normalizedText = String(row.questionText || '').trim().toLowerCase();
            const key = normalizedText || String(row.questionId || '').trim() || `${row.questionText || ''}-${row.timestamp || 0}`;
            if (!indexByQuestionKey.has(key)) {
              const entry = {
                questionId: row.questionId || null,
                questionText: row.questionText || '',
                answer: row.answer ?? null,
                correct: row.correct ?? null,
                hintRequested: row.hintRequested ?? null,
                timestamp: row.timestamp || null
              };
              indexByQuestionKey.set(key, collapsed.length);
              collapsed.push(entry);
            } else {
              const entry = collapsed[indexByQuestionKey.get(key)];
              if (row.answer !== null && row.answer !== undefined && String(row.answer).trim()) {
                entry.answer = row.answer;
              }
              if (row.correct !== null && row.correct !== undefined) entry.correct = row.correct;
              if (row.hintRequested !== null && row.hintRequested !== undefined) entry.hintRequested = row.hintRequested;
              if (row.timestamp && (!entry.timestamp || Number(row.timestamp) > Number(entry.timestamp))) {
                entry.timestamp = row.timestamp;
              }
            }
          }

          if (!collapsed.length) {
            this.db.all(
              `SELECT questionId, answer, correct, hintRequested, timestamp
               FROM progress
               WHERE sessionId = ?
               ORDER BY timestamp ASC`,
              [sessionId],
              (progressErr, progressRows) => {
                if (progressErr) return resolve([]);
                const fallbackTranscript = [];
                const byQuestion = new Map();
                for (const row of progressRows || []) {
                  const key = String(row.questionId || '').trim() || `progress-${fallbackTranscript.length + 1}`;
                  if (!byQuestion.has(key)) {
                    const entry = {
                      questionId: row.questionId || null,
                      questionText: row.questionId ? `Question ${row.questionId}` : `Question ${fallbackTranscript.length + 1}`,
                      answer: row.answer ?? null,
                      correct: row.correct ?? null,
                      hintRequested: row.hintRequested ?? null,
                      timestamp: row.timestamp || null
                    };
                    byQuestion.set(key, fallbackTranscript.length);
                    fallbackTranscript.push(entry);
                  } else {
                    const entry = fallbackTranscript[byQuestion.get(key)];
                    if (row.answer !== null && row.answer !== undefined && String(row.answer).trim()) entry.answer = row.answer;
                    if (row.correct !== null && row.correct !== undefined) entry.correct = row.correct;
                    if (row.hintRequested !== null && row.hintRequested !== undefined) entry.hintRequested = row.hintRequested;
                    if (row.timestamp && (!entry.timestamp || Number(row.timestamp) > Number(entry.timestamp))) entry.timestamp = row.timestamp;
                  }
                }
                resolve(fallbackTranscript);
              }
            );
            return;
          }
          resolve(collapsed);
        }
      );
    });
  }

  recordAnalytics(event, details) {
    const timestamp = Date.now();
    return new Promise((resolve, reject) => {
      this.db.run(`INSERT INTO analytics (event, details, timestamp) VALUES (?, ?, ?)`, [event, JSON.stringify(details || {}), timestamp], function (err) {
        if (err) return reject(err);
        resolve({ id: this.lastID });
      });
    });
  }

  getSessionProgress(sessionId) {
    return new Promise((resolve, reject) => {
      this.db.all(`SELECT studentId, COUNT(*) as total, SUM(correct) as correct FROM progress WHERE sessionId = ? GROUP BY studentId`, [sessionId], (err, rows) => {
        if (err) return reject(err);
        const result = {};
        for (const row of rows || []) {
          result[row.studentId] = { total: row.total, correct: row.correct, rate: row.total > 0 ? (row.correct / row.total) : 0 };
        }
        resolve(result);
      });
    });
  }

  createEnrollment({ id, studentName, studentCode, studentKey, curriculumId, teacherId, classname }) {
    const created_at = Date.now();
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO enrollments (id, studentName, studentCode, studentKey, curriculumId, teacherId, classname, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, studentName, studentCode, studentKey, curriculumId, teacherId, classname, created_at],
        function (err) {
          if (err) return reject(err);
          resolve({ id, studentName, studentCode, studentKey, curriculumId, teacherId, classname, created_at });
        }
      );
    });
  }

  getEnrollmentsByStudent(studentKey, studentName, studentCode) {
    return new Promise((resolve, reject) => {
      const query = `SELECT e.*, c.classname AS curriculumClassname, c.filename AS curriculumFilename, c.metadata
                     FROM enrollments e
                     LEFT JOIN curricula c ON c.id = e.curriculumId
                     WHERE lower(trim(e.studentKey)) = lower(trim(?))
                        OR (lower(trim(e.studentName)) = lower(trim(?)) AND lower(trim(coalesce(e.studentCode, ''))) = lower(trim(?)))
                        OR lower(trim(coalesce(e.studentCode, ''))) = lower(trim(?))
                        OR lower(trim(e.studentName)) = lower(trim(?))
                     ORDER BY e.created_at DESC`;
      this.db.all(query, [studentKey, studentName, studentCode, studentCode, studentName], (err, rows) => {
        if (err) return reject(err);
        const result = (rows || []).map((row) => {
          if (row.metadata) {
            try {
              row.metadata = JSON.parse(row.metadata);
              row.curriculumMetadata = row.metadata;
            } catch (e) {
              row.curriculumMetadata = {};
            }
          } else {
            row.curriculumMetadata = {};
          }
          return row;
        });
        resolve(result);
      });
    });
  }

  getDashboard(sessionId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT 
           studentId,
           COUNT(*) as attempts,
           SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correctAnswers,
           SUM(CASE WHEN hintRequested = 1 THEN 1 ELSE 0 END) as hintsUsed
         FROM progress
         WHERE sessionId = ?
         GROUP BY studentId`,
        [sessionId],
        (err, rows) => {
          if (err) return reject(err);
          const metrics = (rows || []).map((row) => ({
            studentId: row.studentId,
            attempts: row.attempts,
            correctAnswers: row.correctAnswers,
            correctRate: row.attempts > 0 ? row.correctAnswers / row.attempts : 0,
            hintsUsed: row.hintsUsed
          }));
          resolve(metrics);
        }
      );
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}

module.exports = new DataManager();
