import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appSource = await readFile(resolve(root, 'src/NormalizedApp.tsx'), 'utf8');
assert.doesNotMatch(appSource, /\{editingTask\s*&&\s*<TaskEditModal/,
  'TaskEditModal must not render directly from cloned editingTask state');
assert.match(appSource, /\{authorizedEditingTask\s*&&\s*<TaskEditModal/,
  'TaskEditModal must render only from the current authorized visible-task selector');

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const {
    cleanupNormalizedTaskEditorDraft,
    createNormalizedAuthorizationEpoch,
    openNormalizedTaskEditor,
    resolveAuthorizedTaskEditor,
  } = await server.ssrLoadModule('/src/normalizedAuthorizationUi.ts');
  const task = {
    id: 'secret-task',
    vesselId: 'vessel-b',
    vesselIds: ['vessel-b'],
    description: 'scope-revoked modal secret',
  };
  const ownerEpoch = createNormalizedAuthorizationEpoch({
    authorizationGeneration: 1,
    projectionGeneration: 1,
    actorId: 'owner-a',
    role: 'owner',
    permissionBits: '1111',
    vesselIds: ['vessel-a', 'vessel-b'],
  });
  const editor = openNormalizedTaskEditor(task, {
    authorizationEpoch: ownerEpoch,
    creating: false,
    progressVesselId: '',
    draftOwner: {
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      entityKey: 'task:secret-task',
    },
  });
  assert.equal(resolveAuthorizedTaskEditor(editor, {
    authorizationEpoch: ownerEpoch,
    visibleTasks: [task],
    visibleVesselIds: new Set(['vessel-a', 'vessel-b']),
    canCreate: true,
  })?.description, 'scope-revoked modal secret');

  const revokedEpoch = createNormalizedAuthorizationEpoch({
    authorizationGeneration: 1,
    projectionGeneration: 2,
    actorId: 'owner-a',
    role: 'operator',
    permissionBits: '0000',
    vesselIds: ['vessel-a'],
  });
  assert.equal(resolveAuthorizedTaskEditor(editor, {
    authorizationEpoch: revokedEpoch,
    visibleTasks: [],
    visibleVesselIds: new Set(['vessel-a']),
    canCreate: false,
  }), null, 'scope revocation must synchronously hide the stale task modal');

  const sameUserAbaEpoch = createNormalizedAuthorizationEpoch({
    authorizationGeneration: 3,
    projectionGeneration: 1,
    actorId: 'owner-a',
    role: 'owner',
    permissionBits: '1111',
    vesselIds: ['vessel-a', 'vessel-b'],
  });
  assert.equal(resolveAuthorizedTaskEditor(editor, {
    authorizationEpoch: sameUserAbaEpoch,
    visibleTasks: [task],
    visibleVesselIds: new Set(['vessel-a', 'vessel-b']),
    canCreate: true,
  }), null, 'old task editors must not ride a same-user auth ABA');

  const ordinaryRefreshEpoch = createNormalizedAuthorizationEpoch({
    authorizationGeneration: 1,
    projectionGeneration: 99,
    actorId: 'owner-a',
    role: 'owner',
    permissionBits: '1111',
    vesselIds: ['vessel-b', 'vessel-a'],
  });
  assert.equal(ordinaryRefreshEpoch, ownerEpoch,
    'ordinary projection revisions are not authorization scope changes');
  assert.equal(resolveAuthorizedTaskEditor(editor, {
    authorizationEpoch: ordinaryRefreshEpoch,
    visibleTasks: [{ ...task, description: 'new server data' }],
    visibleVesselIds: new Set(['vessel-a', 'vessel-b']),
    canCreate: true,
  })?.description, 'scope-revoked modal secret',
  'an authorized ordinary refresh preserves the unsaved editor clone for CAS/conflict handling');

  let removedOwner = null;
  assert.doesNotThrow(() => cleanupNormalizedTaskEditorDraft(editor, owner => {
    removedOwner = owner;
  }), 'editor cleanup after sign-out must not require live actor scope');
  assert.deepEqual(removedOwner, {
    workspaceId: 'workspace-a',
    actorId: 'owner-a',
    entityKey: 'task:secret-task',
  }, 'draft cleanup must use the editor-opening owner, never a replacement actor');
  assert.doesNotThrow(() => cleanupNormalizedTaskEditorDraft(editor, () => {
    throw new Error('storage unavailable after sign-out');
  }), 'durable cleanup failure must not abort synchronous sensitive UI purge');
} finally {
  await server.close();
}

console.log('normalized_editor_scope_revocation=PASS');
