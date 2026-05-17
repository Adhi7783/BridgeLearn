const dm = require('../src/dataManager');

(async () => {
  try {
    const curriculumId = 'c-ff095da8-088a-45c4-a27c-5f82df48f915'; // Grade 8 Computer Vision Elective
    const teacherId = 'u-e7ab99a6-3e6c-4350-87b3-b85dc28f461f';
    const classname = 'Grade 8 Computer Vision Elective';

    console.log('Before assignment:');
    const before = await dm.listEnrollmentsByStudent({ studentName: 'Student 8-1', studentCode: 'BRIDGE-08-01' });
    console.log(JSON.stringify(before.map(e => ({ id: e.id, curriculumId: e.curriculumId, classname: e.classname })), null, 2));

    const result = await dm.assignCurriculumToClass(curriculumId, teacherId, classname);
    console.log('Assign result:', result);

    console.log('After assignment:');
    const after = await dm.listEnrollmentsByStudent({ studentName: 'Student 8-1', studentCode: 'BRIDGE-08-01' });
    console.log(JSON.stringify(after.map(e => ({ id: e.id, curriculumId: e.curriculumId, classname: e.classname })), null, 2));

    process.exit(0);
  } catch (err) {
    console.error('Smoke test failed:', err);
    process.exit(1);
  }
})();
