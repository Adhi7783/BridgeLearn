const fs = require('fs');
const path = require('path');

const dataManager = require('../src/dataManager');

const repoRoot = path.resolve(__dirname, '..', '..');
const referencePath = path.join(repoRoot, 'bridgelearn-reference.txt');

function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '_' + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join('');
}

function queryAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    dataManager.db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function queryOne(sql, params = []) {
  return new Promise((resolve, reject) => {
    dataManager.db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function parseMetadata(rawMetadata) {
  if (!rawMetadata) return {};
  if (typeof rawMetadata === 'object') return rawMetadata;
  try {
    return JSON.parse(rawMetadata);
  } catch {
    return {};
  }
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function deriveJoinCode(student) {
  const fromEmail = String(student?.email || '').toLowerCase().match(/student-bridge-(\d{2})-(\d{2})@/);
  if (fromEmail) {
    return `BRIDGE-${fromEmail[1]}-${fromEmail[2]}`;
  }
  const fromName = String(student?.name || '').match(/student\s*(\d+)[- ](\d+)/i);
  if (fromName) {
    return `BRIDGE-${String(fromName[1]).padStart(2, '0')}-${String(fromName[2]).padStart(2, '0')}`;
  }
  return '';
}

function buildReferenceText(summary, teachers, students, orphans) {
  const lines = [];
  lines.push('# BridgeLearn Reference');
  lines.push('');
  lines.push(`- Database: ${path.join(repoRoot, 'data', 'bridgelearn.db')}`);
  lines.push(`- Teachers: ${summary.totalTeachers}`);
  lines.push(`- Students: ${summary.totalStudents}`);
  lines.push(`- Weekly lesson plans: ${summary.totalCurricula}`);
  lines.push(`- Enrollments: ${summary.totalEnrollments}`);
  lines.push(`- Student question limit: teacher-configurable per curriculum, default 5`);
  lines.push(`- Generated: ${new Date().toISOString()}`);
  if (orphans.length) {
    lines.push(`- Orphan curricula removed: ${orphans.length}`);
  }
  lines.push('');
  lines.push('## Teachers and Weekly Lesson Plans');

  for (const teacher of teachers) {
    lines.push(`### ${teacher.name || 'Unnamed teacher'}`);
    lines.push(`- Teacher ID: ${teacher.id}`);
    lines.push(`- Email: ${teacher.email || ''}`);
    lines.push(`- Status: ${teacher.status || ''}`);
    const curricula = teacher.curricula || [];
    if (curricula.length === 0) {
      lines.push(`- No weekly lesson plans yet`);
    } else {
      for (const curriculum of curricula) {
        const metadata = curriculum.metadata || {};
        const status = metadata.extractionStatus ? ` | extractionStatus=${metadata.extractionStatus}` : '';
        lines.push(`- ${curriculum.classname || curriculum.filename || curriculum.id} | ${curriculum.id} | ${curriculum.filename || ''}${status}`);
      }
    }
    lines.push('');
  }

  lines.push('## Students and Class Enrollments');
  lines.push('- Join code for each student is the studentCode shown in their entry.');

  for (const student of students) {
    lines.push(`### ${student.name || 'Unnamed student'}`);
    lines.push(`- Student ID: ${student.id}`);
    lines.push(`- Email: ${student.email || ''}`);
    lines.push(`- Status: ${student.status || ''}`);
    lines.push(`- Join code: ${student.joinCode || ''}`);
    const enrollments = student.enrollments || [];
    if (enrollments.length === 0) {
      lines.push(`- No enrollments`);
    } else {
      for (const enrollment of enrollments) {
        lines.push(`- ${enrollment.classname || enrollment.curriculumClassname || enrollment.curriculumFilename || enrollment.curriculumId} | studentCode=${enrollment.studentCode || ''} | curriculumId=${enrollment.curriculumId || ''} | teacherId=${enrollment.teacherId || ''}`);
      }
    }
    lines.push('');
  }

  if (orphans.length) {
      lines.push('## Orphan Weekly Lesson Plans');
    for (const curriculum of orphans) {
        lines.push(`- ${curriculum.classname || curriculum.filename || curriculum.id} | ${curriculum.id} | ${curriculum.filename || ''} | teacherId=${curriculum.teacherId || ''}`);
    }
    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

async function main() {
  const summary = {
    totalTeachers: (await queryOne(`SELECT COUNT(*) AS cnt FROM users WHERE role = 'Teacher'`))?.cnt || 0,
    totalStudents: (await queryOne(`SELECT COUNT(*) AS cnt FROM users WHERE role = 'Student'`))?.cnt || 0,
    totalCurricula: (await queryOne(`SELECT COUNT(*) AS cnt FROM curricula`))?.cnt || 0,
    totalEnrollments: (await queryOne(`SELECT COUNT(*) AS cnt FROM enrollments`))?.cnt || 0
  };

  const teachers = await queryAll(
    `SELECT id, role, name, email, status FROM users WHERE role = 'Teacher' ORDER BY lower(name), lower(email)`
  );
  for (const teacher of teachers) {
    teacher.curricula = await queryAll(
      `SELECT id, filename, classname, metadata, created_at FROM curricula WHERE teacherId = ? ORDER BY created_at DESC`,
      [teacher.id]
    );
    teacher.curricula = teacher.curricula.map((curriculum) => ({
      ...curriculum,
      metadata: parseMetadata(curriculum.metadata)
    }));
  }

  const orphanCurricula = await queryAll(
    `SELECT id, filename, classname, metadata, teacherId FROM curricula WHERE teacherId IS NULL OR trim(teacherId) = '' ORDER BY created_at DESC`
  );
  const orphanCurriculumIds = new Set(orphanCurricula.map((curriculum) => curriculum.id));

  const students = await queryAll(
    `SELECT id, name, email, status FROM users WHERE role = 'Student' ORDER BY lower(name), lower(email)`
  );
  for (const student of students) {
    student.joinCode = deriveJoinCode(student);
    const enrollments = await queryAll(
      `SELECT e.*, c.classname AS curriculumClassname, c.filename AS curriculumFilename, c.metadata
       FROM enrollments e
       LEFT JOIN curricula c ON c.id = e.curriculumId
       WHERE lower(trim(e.studentCode)) = lower(trim(?))
          OR lower(trim(e.studentName)) = lower(trim(?))
       ORDER BY e.created_at DESC`,
      [student.joinCode, student.name]
    );
    student.enrollments = enrollments
      .filter((enrollment) => enrollment.curriculumId && !orphanCurriculumIds.has(enrollment.curriculumId))
      .map((enrollment) => ({
        ...enrollment,
        metadata: parseMetadata(enrollment.metadata)
      }));

    if (!student.enrollments.length) {
      const fallbackEnrollments = await queryAll(
        `SELECT e.*, c.classname AS curriculumClassname, c.filename AS curriculumFilename, c.metadata
         FROM enrollments e
         LEFT JOIN curricula c ON c.id = e.curriculumId
         WHERE lower(trim(e.studentCode)) = lower(trim(?))
            OR lower(trim(e.studentKey)) = lower(trim(?))
            OR lower(trim(e.studentName)) = lower(trim(?))
         ORDER BY e.created_at DESC`,
        [student.joinCode, `${student.name}|${student.joinCode}`, student.name]
      );
      student.enrollments = fallbackEnrollments
        .filter((enrollment) => enrollment.curriculumId && !orphanCurriculumIds.has(enrollment.curriculumId))
        .map((enrollment) => ({
          ...enrollment,
          metadata: parseMetadata(enrollment.metadata)
        }));
    }
  }

  const previous = fs.existsSync(referencePath) ? fs.readFileSync(referencePath, 'utf8') : '';
  if (previous) {
    const backupPath = `${referencePath}.bak-${formatTimestamp()}`;
    fs.writeFileSync(backupPath, previous, 'utf8');
    console.log(`Backup written to ${backupPath}`);
  }

  const content = buildReferenceText(summary, teachers, students, orphanCurricula.map((curriculum) => ({
    ...curriculum,
    metadata: parseMetadata(curriculum.metadata)
  })));

  fs.writeFileSync(referencePath, content, 'utf8');
  console.log(`Reference refreshed at ${referencePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});