import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const adminSource = await readFile(new URL('../src/pages/admin-v2/index.astro', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');

assert.ok(
  adminSource.includes('id="import-delete-record"'),
  'Admin import detail should expose a delete import record button.'
);
assert.ok(
  adminSource.includes('deleteSelectedImport'),
  'Admin import detail should wire the delete button to a delete handler.'
);
assert.ok(
  adminSource.includes('已导入的作品和章节不会被删除'),
  'Admin delete confirmation should clarify linked content entries are kept.'
);
assert.ok(
  adminSource.includes("JSON.stringify({ action: 'delete', importId: state.selectedImportId })"),
  'Admin delete handler should send the delete review action with the selected import id.'
);
assert.ok(
  adminSource.includes('state.imports = state.imports.filter'),
  'Admin delete handler should remove the deleted import record from the visible list.'
);

assert.ok(
  workerSource.includes("['publish', 'delete'].includes(action)"),
  'Import review API should accept publish and delete actions.'
);
assert.ok(
  workerSource.includes("if (action === 'delete')"),
  'Import review API should branch delete handling before publish handling.'
);
assert.ok(
  workerSource.includes('DELETE FROM content_imports'),
  'Import review API should delete only the content_imports row.'
);
assert.ok(
  workerSource.includes('novelforge_import_deleted_review_record'),
  'Import review API should write an audit log for manual import record deletion.'
);
assert.ok(
  workerSource.includes('Linked content entries were kept'),
  'Import review API response should clarify linked content entries were kept.'
);
assert.match(
  workerSource,
  /buildContentImportListQuery\(\{ importId, importType, limit, review \}\)/,
  'Import list API should use the tested review query builder.'
);

console.log('admin import delete tests passed');
