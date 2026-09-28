import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { createNativeRecordQa } from './record-storage-native-qa.mjs';
import { createRecordStorageLocalQa } from './record-storage-local-qa.mjs';
import { installTrackingBrowserMigrations } from './tracking-browser-fixture.mjs';

// Owned fresh loopback PostgreSQL only. No production/config/credential input.
const root = process.env.QA_EVIDENCE_ROOT;
assert.ok(root && path.isAbsolute(root), 'Absolute QA_EVIDENCE_ROOT required');
fs.mkdirSync(root, { recursive: true });
const output = fs.mkdtempSync(path.join(root, 'tracking-soft-delete-native-'));
const evidence = { label: 'Native PostgreSQL / synthetic data / not production', cases: [], productionContacted: false };
const migration = 'supabase/migrations/20260928220000_tracking_soft_delete.sql';
const readback = 'supabase/verification/tracking-soft-delete-readback.sql';
const beforeUpgrade = process.argv.includes('--before-upgrade');
const crlf = process.argv.includes('--crlf-install');
const inputPaths = [migration, readback, 'scripts/verify-tracking-soft-delete-native.mjs', 'scripts/record-storage-native-qa.mjs', 'scripts/tracking-browser-fixture.mjs', 'src/tracking/trackingDeletion.ts', 'src/tracking/trackingLifecycle.ts', 'src/internalControlData.ts', 'src/cloudBlockPatch.ts'];
const inputHashes = () => Object.fromEntries(inputPaths.filter(f => fs.existsSync(f)).map(f => [f, createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
evidence.inputs = inputHashes(); evidence.installationLineEndings = crlf ? 'CRLF' : 'LF';
const sqlText = file => fs.readFileSync(file, 'utf8').replace(/\r?\n/g, crlf ? '\r\n' : '\n');
const check = async (name, run) => { await run(); evidence.cases.push(name); console.log('PASS', name); };
let native, qa, failure;
try {
  const listener = net.createServer();
  await new Promise((r, j) => { listener.once('error', j); listener.listen(0, '127.0.0.1', r); });
  process.env.QA_HMR_PORT = String(listener.address().port);
  await new Promise(r => listener.close(r));
  process.env.QA_VITE_CACHE_DIR = path.join(output, 'vite-cache');
  native = await createNativeRecordQa(output, evidence, { httpTransactions: true });
  qa = await createRecordStorageLocalQa({ internalControl: true, browserAuthority: true, scopedRead: true, shipInternalControl: true, tracking: true, taskMember: true, databaseFactory: async () => native.adapter });
  await installTrackingBrowserMigrations(qa.db);
  // Explicit immutable predecessor chain, independent of shared convenience installers.
  for (const name of ['20260925020000_edit_lock_holder.sql', '20260925080000_ship_tracking_public.sql', '20260925160000_tracking_field_revision.sql', '20260927130000_tracking_fleet_statistics.sql', '20260928140000_tracking_annual_types.sql', '20260928180000_tracking_reclassification.sql']) await qa.db.exec(sqlText('supabase/migrations/' + name));
  const rpc = async (action, payload = {}, vessel = 'qa-v1', actor = '11111111-1111-4111-8111-111111111111', holder = '22222222-2222-4222-8222-222222222222') => qa.db.transaction(async tx => {
    await tx.exec('set local role anon');
    return (await tx.query('select public.ship_dynamics_tracking_public_v1($1,$2,$3::uuid,$4::uuid,$5,$6::jsonb) result', [qa.workspace, vessel, actor, holder, action, JSON.stringify(payload)])).rows[0].result;
  });
  const submit = async (name, ids, make, creation = false) => {
    const bundleId = randomUUID();
    const claim = await rpc('claim', { bundleId, ids, creation });
    assert.equal(claim.ok, true, JSON.stringify(claim));
    const request = { operationId: name, bundleId, command: make(claim.data.trackingItems) };
    try { return { request, result: await rpc('submit', request) }; }
    finally { await rpc('release', { bundleId }); }
  };
  const source = { id: 'soft-source', kind: 'supply', requestType: 'spares', vesselId: 'qa-v1', referenceNo: 'QA-SOFT-DELETE-001', description: '來源手工內容', applicationDate: '2026-09-01', urgency: 'urgent', urgentSubtypes: ['manual'], progress: '初始進度', expectedDate: '2026-09-02', supplementalNotes: '保留備註', purchaseNos: '000123', deliveryStatus: 'delivered', actualDeliveryDate: '2026-09-03', completionDate: '2026-08-10', supplier: '保留供應商', contractor: '保留工程商', source: { fileName: 'synthetic.xlsx', row: 2, originalValues: { type: 'original' } } };
  const sibling = { ...source, id: 'soft-unselected', requestType: 'temporary-materials', deliveryStatus: 'not-delivered', actualDeliveryDate: '' };
  const unselected = { ...source, id: 'soft-never-selected', deliveryStatus: 'not-delivered', actualDeliveryDate: '' };
  const created = await submit('soft-create', [source.id, sibling.id, unselected.id], () => ({ type: 'create', items: [source, sibling, unselected] }), true);
  assert.equal(created.result.status, 'committed');
  assert.equal((await submit('soft-sync', [source.id], rows => ({ type: 'sync', reporterNameAndRole: 'QA／測試', items: [{ id: source.id, expectedUpdatedAt: rows.find(r => r.id === source.id).updatedAt, item: { id: 'soft-case', reportDate: '2026-09-01', reportSource: '日常', description: '案例手工前文\n類型：備件\n實際送達/完工日期：2026-09-03\n案例手工尾文', priority: '低', category: '維修', equipmentSubcategory: '', isAware: false, status: source.progress, departments: ['督導'], expectedDate: '2026-10-02' } }] }))).result.status, 'committed');
  const { buildCloudBlockPatch } = await qa.loadModule('/src/cloudBlockPatch.ts');
  const ic = await qa.loadModule('/src/internalControlData.ts');
  const office = async (name, mutate, options = {}) => {
    const base = (await qa.read()).payload, next = structuredClone(base), actor = base.users.find(u => options.actorId ? u.id === options.actorId : u.role === 'owner');
    await mutate(next, actor, new Date().toISOString());
    let operations = buildCloudBlockPatch(base, next);
    if (options.operations) operations = options.operations(operations);
    const guards = [], keys = new Set(['tracking:' + source.id]);
    for (const op of operations) if (op.kind === 'entity' && ['trackingItems', 'internalControlCases', 'tasks'].includes(op.collection)) keys.add((op.collection === 'trackingItems' ? 'tracking:' : op.collection === 'tasks' ? 'task:' : op.expected ? 'internal-control:' : 'internal-control-create:') + op.entityId);
    try {
      for (const key of [...keys].sort()) {
        const lease = (await qa.db.query("select claim_ship_dynamics_edit_lock($1,$2,'qa-soft-office','QA OFFICE',75) result", [qa.workspace, key])).rows[0].result;
        assert.equal(lease.ok, true, key); guards.push({ section_key: key, locked_by: lease.locked_by, lease_version: lease.lease_version });
      }
      const guard = (await qa.db.query('select ship_dynamics_actor_guard($1::jsonb,$2) result', [JSON.stringify(base), actor.id])).rows[0].result;
      const args = [qa.workspace, name, JSON.stringify(operations), 'QA OFFICE', actor.id, JSON.stringify(guard), null, JSON.stringify(options.guards ? options.guards(guards) : guards)];
      if (options.capture) options.capture(args);
      return await qa.db.transaction(async tx => (await tx.query('select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) result', args)).rows[0].result);
    } finally { await qa.db.query("delete from ship_dynamics_edit_locks where workspace_key=$1 and locked_by='qa-soft-office'", [qa.workspace]); }
  };
  const linked = await office('soft-link-task', (d, u, at) => {
    const c = d.internalControlCases.find(c => c.id === 'soft-case');
    ic.updateInternalControlCase(d, { ...c, syncToTask: true }, c.updatedAt, u, at, { categories: ['維修'], expectedDate: '2026-11-01', ownerUserIds: [u.id], isAbnormal: false });
  });
  assert.equal(linked.ok, true, JSON.stringify(linked));
  // Independently customized endpoint text is intentional; the source label is
  // replaced in each endpoint, never by copying the case body over the task.
  const taskId = (await qa.read()).payload.internalControlCases.find(c => c.id === 'soft-case').linkedTaskId;
  await qa.db.query("update ship_dynamics_records set value=jsonb_set(value,'{description}',to_jsonb($3::text)) where workspace_key=$1 and collection='tasks' and entity_id=$2", [qa.workspace, taskId, '<p>任務手工前文</p><p>類型：備件</p><p>實際送達/完工日期：2026-09-03</p><p>任務手工尾文</p>']);
  // Physical rows plus all business/history/revision tables; deliberately exclude
  // rejected-command receipts and leases, which are expected protocol effects.
  const ledger = async () => {
    const result = {};
    for (const name of ['ship_dynamics_record_workspaces', 'ship_dynamics_record_collections', 'ship_dynamics_records', 'ship_dynamics_record_versions', 'ship_dynamics_record_history', 'ship_dynamics_record_task_progress', 'ship_dynamics_record_task_progress_history']) {
      result[name] = (await qa.db.query(`select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('_xmin',xmin::text,'_ctid',ctid::text) order by to_jsonb(r)::text),'[]') rows from public.${name} r where workspace_key=$1`, [qa.workspace])).rows[0].rows;
    }
    return result;
  };

  const value = s => ({ deletion: s.deletion || null, deletionRequest: s.deletionRequest || null });
  const apply = (s, action, reason, actor, at, operationId) => {
    reason = reason.trim(); const before = value(s);
    if (action === 'delete') {
      s.deletion = { at, byUserId: actor.id, reason };
      if (s.deletionRequest?.status === 'pending') s.deletionRequest = { ...s.deletionRequest, status: 'approved', reviewedAt: at, reviewedBy: actor.id, reviewReason: reason };
    } else if (action === 'restore') delete s.deletion;
    else if (action === 'request-delete') s.deletionRequest = { at, byUserId: actor.id, reason, status: 'pending' };
    else s.deletionRequest = { ...s.deletionRequest, status: 'rejected', reviewedAt: at, reviewedBy: actor.id, reviewReason: reason };
    s.updatedAt = at; s.updatedBy = actor.id;
    s.events = [...(s.events || []), { id: `${operationId}:${s.id}:${action}`, operationId, action, before, after: { ...value(s), reason }, byUserId: actor.id, at, entry: 'tracking' }];
    return s;
  };
  const current = async (id = source.id) => (await qa.read()).payload.trackingItems.find(s => s.id === id);
  const officeAction = (name, action, ids = [source.id], options = {}, reason = '岸端核對原因') => office(name, (d, u, at) => { for (const id of ids) apply(d.trackingItems.find(s => s.id === id), action, reason, u, at, name); }, options);
  const requestDelete = (name, ids = [source.id], reason = '船端申請理由') => submit(name, ids, rows => ({ type: 'request-delete', items: ids.map(id => ({ id, expectedUpdatedAt: rows.find(s => s.id === id).updatedAt, reason })) }));
  const rejection = async (name, make, ids = [source.id], creation = false) => {
    const before = await ledger(), { result, request } = await submit(name, ids, make, creation);
    assert.equal(result.status, 'rejected', JSON.stringify(result)); assert.deepEqual(await ledger(), before);
    assert.equal((await rpc('receipt', request)).status, 'rejected');
    return result;
  };
  const rejectOffice = async (name, mutate, options = {}) => {
    const before = await ledger(), result = await office(name, mutate, options);
    assert.equal(result.ok, false, name + ': ' + JSON.stringify(result)); assert.deepEqual(await ledger(), before);
    return result;
  };
  const callStats = (version, scope = { kind: 'vessel', value: 'qa-v1' }, query = { from: '', to: '', type: 'all', urgency: 'all' }) => qa.db.transaction(async tx => {
    await tx.exec('set local role anon');
    return (await tx.query(`select read_ship_dynamics_tracking_statistics_public_v${version}($1,$2::jsonb,$3::jsonb) r`, [qa.workspace, JSON.stringify(scope), JSON.stringify(query)])).rows[0].r;
  });
  const endpointPhysical = async () => (await ledger()).ship_dynamics_records.filter(r => ['internalControlCases', 'tasks'].includes(r.collection));
  if (process.argv.includes('--red-forgery')) await check('forged-shore-metadata-without-event-is-rejected', () => rejectOffice('soft-forgery-red', (d, u, at) => { d.trackingItems.find(s => s.id === source.id).deletion = { at, byUserId: u.id, reason: 'forged' }; }));
  if (process.argv.includes('--red-archive')) {
    await qa.db.query("update ship_dynamics_records set value=value||'{\"deletion\":{\"at\":\"2026-09-28T00:00:00Z\",\"byUserId\":\"qa-owner\",\"reason\":\"fixture\"}}'::jsonb where workspace_key=$1 and collection='trackingItems' and entity_id=$2", [qa.workspace, source.id]);
    await check('archived-direct-shore-edit-is-rejected', () => rejectOffice('soft-archive-red', d => { d.trackingItems.find(s => s.id === source.id).description = 'direct archived overwrite'; }));
  }
  const changedNames = ['deletion_value_v1', 'apply_deletion_v1', 'validate_deletion_v1', 'ship_dynamics_tracking_validate_v1', 'plan_v1', 'submit_v1', 'read_v1', 'read_ship_dynamics_tracking_statistics_public_v1', 'read_ship_dynamics_tracking_statistics_public_v2'];
  const catalog = async (excludeChanged = false) => (await qa.db.query("select oid::text,pronamespace::regnamespace::text schema,proname,md5(replace(prosrc,chr(13)||chr(10),chr(10))) body_hash,proacl::text,prosecdef,provolatile,proconfig,proargnames from pg_proc where pronamespace in ('public'::regnamespace,'ship_dynamics_tracking_private'::regnamespace) and not(proname=any($1::text[])) order by oid", [excludeChanged ? changedNames : []])).rows;
  const installLedger = async () => ({ business: await ledger(), receipts: (await qa.db.query('select * from ship_dynamics_record_receipts where workspace_key=$1 order by operation_id', [qa.workspace])).rows, bundles: (await qa.db.query('select * from ship_dynamics_tracking_private.bundles where workspace=$1 order by bundle_id', [qa.workspace])).rows });
  if (!beforeUpgrade) {
    await check('unknown-predecessor-functions-fail-before-DDL-with-zero-effects', async () => {
      for (const signature of ['public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)', 'ship_dynamics_tracking_private.plan_v1(text,text,jsonb,jsonb,text,text,text,text)', 'ship_dynamics_tracking_private.submit_v1(text,text,uuid,uuid,jsonb,boolean)', 'ship_dynamics_tracking_private.read_v1(text,text)', 'public.read_ship_dynamics_tracking_statistics_public_v1(text,jsonb,jsonb)', 'public.read_ship_dynamics_tracking_statistics_public_v2(text,jsonb,jsonb)']) {
        const original = (await qa.db.query('select pg_get_functiondef($1::regprocedure) definition', [signature])).rows[0].definition;
        const unknown = original.replace(/begin\r?\n/, 'begin\n -- soft-delete unknown predecessor QA\n'); assert.notEqual(unknown, original);
        await qa.db.exec(unknown); const before = await installLedger(), cat = await catalog();
        await assert.rejects(qa.db.exec(sqlText(migration)), /tracking-soft-delete-predecessor-mismatch/); await qa.db.exec('rollback');
        assert.deepEqual(await installLedger(), before); assert.deepEqual(await catalog(), cat);
        assert.equal((await qa.db.query("select to_regprocedure('ship_dynamics_tracking_private.apply_deletion_v1(jsonb,text,text,text,text,text)') p")).rows[0].p, null);
        await qa.db.exec(original);
      }
    });
    await check('LF-CRLF-forward-repeat-install-preserves-business-old-receipt-and-unrelated-functions', async () => {
      const before = await installLedger(), cat = await catalog(true);
      await qa.db.exec(sqlText(migration)); await qa.db.exec(sqlText(migration));
      await qa.db.exec(fs.readFileSync(migration, 'utf8').replace(/\r?\n/g, crlf ? '\n' : '\r\n'));
      assert.deepEqual(await installLedger(), before); assert.deepEqual(await catalog(true), cat);
      assert.equal((await rpc('submit', created.request)).replayed, true); assert.deepEqual(await installLedger(), before);
    });
  }
  if (!beforeUpgrade) await check('TS-SQL-canonical-deletion-helper-parity-including-trim-and-Unicode-boundary', async () => {
    const { applyTrackingDeletion } = await qa.loadModule('/src/tracking/trackingDeletion.ts');
    const base = await current(), actor = { id: 'qa-soft-parity', name: 'QA' }, at = '2026-09-28T22:00:00.000Z';
    let comparisons = 0;
    for (const action of ['delete', 'restore', 'request-delete', 'reject-delete']) for (const reason of ['valid', '\v valid \v', '\t\n\r reason \u00a0\ufeff', 'x'.repeat(500), '😀'.repeat(250), '😀'.repeat(251), '', ' '.repeat(5), 'x'.repeat(501)]) {
      const b = structuredClone(base); delete b.deletion; delete b.deletionRequest;
      if (action === 'restore') b.deletion = { at, byUserId: actor.id, reason: 'previous' };
      if (action === 'reject-delete' || action === 'delete') b.deletionRequest = { at, byUserId: 'public-tracking-vessel:qa-v1', reason: 'previous', status: 'pending' };
      const expected = structuredClone(b); let invalid = false;
      try { applyTrackingDeletion(expected, action, reason, actor, at, 'parity'); } catch { invalid = true; }
      const sql = () => qa.db.query('select ship_dynamics_tracking_private.apply_deletion_v1($1::jsonb,$2,$3,$4,$5,$6) v', [JSON.stringify(b), action, reason, actor.id, at, 'parity']);
      if (invalid) await assert.rejects(sql(), /tracking-deletion/);
      else assert.deepEqual((await sql()).rows[0].v, expected, action + ': ' + JSON.stringify(reason));
      comparisons++;
    }
    evidence.deletionParityComparisons = comparisons;
  });
  await check('ship-request-delete-commits-source-only-with-anonymous-provenance', async () => {
    const before = (await qa.read()).payload;
    const { result, request } = await submit('soft-request-first', [source.id], rows => ({ type: 'request-delete', items: [{ id: source.id, expectedUpdatedAt: rows.find(r => r.id === source.id).updatedAt, reason: '  重複申請  ' }] }));
    assert.equal(result.status, 'committed', JSON.stringify(result));
    const after = (await qa.read()).payload, saved = after.trackingItems.find(r => r.id === source.id);
    assert.deepEqual(saved.deletionRequest, { at: saved.updatedAt, byUserId: 'public-tracking-vessel:qa-v1', reason: '重複申請', status: 'pending' });
    assert.equal(saved.deletion, undefined);
    assert.deepEqual(after.internalControlCases, before.internalControlCases); assert.deepEqual(after.tasks, before.tasks);
    assert.equal(saved.events.at(-1).action, 'request-delete');
    assert.equal(saved.events.at(-1).id, request.operationId + ':' + source.id + ':request-delete');
    const frozen = await ledger(); assert.equal((await rpc('submit', request)).replayed, true); assert.deepEqual(await ledger(), frozen);
  });

  await check('pending-status-readable-request-duplicate-rejected-and-both-statistics-include-pending', async () => {
    const data = await rpc('read'); assert.equal(data.trackingItems.find(r => r.id === source.id).deletionRequest.status, 'pending');
    assert.equal(data.tasks, undefined); const c = data.cases.find(c => c.id === 'soft-case'); assert.equal(c.syncToTask, false); assert.equal(c.linkedTaskId, undefined); assert.equal(c.trackingLifecycle, undefined);
    await rejection('soft-duplicate-pending', rows => ({ type: 'request-delete', items: [{ id: source.id, expectedUpdatedAt: rows.find(r => r.id === source.id).updatedAt, reason: 'repeat' }] }));
    for (const v of [1, 2]) assert.equal((await callStats(v)).stats.summary.total, 3);
  });
  const owner = (await qa.read()).payload.users.find(u => u.role === 'owner');
  for (const [id, role, vessels] of [['qa-soft-operator', 'operator', ['qa-v1']], ['qa-soft-viewer', 'viewer', ['qa-v1']], ['qa-soft-other', 'operator', ['qa-v2']]]) {
    const user = { ...owner, id, name: id, username: id, role, managedVesselIds: vessels };
    await qa.db.query("insert into ship_dynamics_records(workspace_key,collection,entity_id,value,revision) values($1,'users',$2,$3::jsonb,1)", [qa.workspace, id, JSON.stringify(user)]);
    await qa.db.query("update ship_dynamics_record_collections set ids=ids||jsonb_build_array($2::text) where workspace_key=$1 and collection='users'", [qa.workspace, id]);
  }
  await qa.db.query("update ship_dynamics_record_workspaces set root=jsonb_set(jsonb_set(root,'{settings,rolePermissions,operator}','{\"viewAllVessels\":false,\"editBusinessContent\":true,\"closeTasks\":false,\"deleteTasks\":false,\"createTasks\":false}'::jsonb),'{settings,rolePermissions,viewer}','{\"viewAllVessels\":false,\"editBusinessContent\":false,\"closeTasks\":false,\"deleteTasks\":false,\"createTasks\":false}'::jsonb) where workspace_key=$1", [qa.workspace]);
  await check('operator-delete-approves-request-without-close-deleteTasks-permissions-and-endpoints-untouched', async () => {
    const base = (await qa.read()).payload, actor = base.users.find(u => u.id === 'qa-soft-operator');
    const guard = (await qa.db.query('select ship_dynamics_actor_guard($1::jsonb,$2) g', [JSON.stringify(base), actor.id])).rows[0].g;
    assert.equal(guard.effectivePermissions.editBusinessContent, true); assert.equal(guard.effectivePermissions.closeTasks, false); assert.equal(guard.effectivePermissions.deleteTasks, false);
    const b = await current(), endpoints = await endpointPhysical();
    const result = await officeAction('soft-operator-delete', 'delete', [source.id], { actorId: actor.id }); assert.equal(result.ok, true, JSON.stringify(result));
    const saved = await current(); const expected = structuredClone(b); apply(expected, 'delete', '岸端核對原因', actor, saved.updatedAt, 'soft-operator-delete'); assert.deepEqual(saved, expected);
    assert.equal(saved.deletionRequest.status, 'approved'); assert.deepEqual(await endpointPhysical(), endpoints);
    assert.deepEqual((await qa.read()).payload.trackingItems.filter(s => s.id !== source.id), base.trackingItems.filter(s => s.id !== source.id));
    evidence.editOnlyOperator = { editBusinessContent: true, closeTasks: false, deleteTasks: false, accepted: result.ok };
  });
  await check('both-public-statistics-exclude-soft-deleted-source-with-old-protocols-unchanged', async () => {
    for (const v of [1, 2]) { const stats = await callStats(v); assert.equal(stats.protocol, `ship-tracking-statistics-v${v}`); assert.equal(stats.stats.summary.total, 2, 'statistics v' + v); }
  });
  await check('deleted-public-projection-retains-own-case-badge-and-no-new-secrets', async () => {
    const data = await rpc('read'), s = data.trackingItems.find(r => r.id === source.id);
    assert.deepEqual(s.deletion, (await current()).deletion); assert.equal(s.deletionRequest.status, 'approved');
    assert.equal(data.cases.some(c => c.id === s.linkedCaseId), true); assert.equal(data.tasks, undefined);
    assert.equal((await rpc('read', {}, 'qa-v2')).trackingItems.some(r => r.id === source.id), false);
    for (const key of ['users', 'settings', 'auditLogs']) assert.equal(data[key], undefined);
  });
  await check('archived-direct-ship-business-and-lifecycle-commands-reject-with-zero-write', async () => {
    const commands = [
      expectedUpdatedAt => ({ type: 'edit', items: [{ id: source.id, expectedUpdatedAt, changes: { description: 'forbidden overwrite' } }] }),
      expectedUpdatedAt => ({ type: 'progress', items: [{ id: source.id, expectedUpdatedAt, text: 'forbidden progress' }] }),
      expectedUpdatedAt => ({ type: 'delivery', items: [{ id: source.id, expectedUpdatedAt, status: 'delivered', date: '2026-09-29' }] }),
      expectedUpdatedAt => ({ type: 'reclassify', items: [{ id: source.id, expectedUpdatedAt, requestType: 'repair', actualDate: '', deliveryStatus: 'delivered' }] }),
      expectedUpdatedAt => ({ type: 'sync', reporterNameAndRole: 'QA', items: [{ id: source.id, expectedUpdatedAt, item: {} }] }),
      expectedUpdatedAt => ({ type: 'lifecycle', action: 'close', date: '2026-09-29', targets: [{ entry: 'tracking', id: source.id, expectedUpdatedAt }] }),
      expectedUpdatedAt => ({ type: 'request-delete', items: [{ id: source.id, expectedUpdatedAt, reason: 'again' }] })
    ];
    for (const [i, make] of commands.entries()) await rejection('soft-archived-ship-' + i, rows => make(rows.find(s => s.id === source.id).updatedAt));
  });
  await check('archived-direct-shore-edits-and-forged-downstream-events-reject', async () => {
    for (const [i, mutate] of [s => { s.description = 'direct archived overwrite'; }, s => { s.supplementalNotes = 'forbidden'; }, s => { s.linkState = 'invalid'; }, s => { s.deletion = null; }, s => { delete s.deletionRequest; }].entries()) await rejectOffice('soft-archived-shore-' + i, d => mutate(d.trackingItems.find(s => s.id === source.id)));
    await rejectOffice('soft-archived-forged-entry', (d, u, at) => {
      const s = d.trackingItems.find(s => s.id === source.id); const before = { isClosed: s.isClosed, closedDate: s.closedDate || '', closedBy: s.closedBy || '' };
      s.isClosed = true; s.closedDate = '2026-09-29'; s.closedBy = u.id; s.updatedAt = at; s.updatedBy = u.id;
      s.events.push({ id: 'fake:' + s.id + ':close', operationId: 'fake', action: 'close', before, after: { isClosed: true, closedDate: s.closedDate, closedBy: u.id }, at, byUserId: u.id, entry: 'internal-control' });
    });
  });
  await check('case-origin-close-date-correction-and-reopen-update-deleted-source-without-restoration', async () => {
    const deleted = (await current()).deletion;
    for (const [name, closed, date] of [['close', true, '2026-10-01'], ['correct-close-date', true, '2026-10-02'], ['reopen', false, '']]) {
      const result = await office('soft-case-' + name, (d, u, at) => {
        const c = d.internalControlCases.find(c => c.id === 'soft-case'), changed = { ...c, isClosed: closed, closedDate: date };
        if (!closed) { delete changed.closedDate; delete changed.closedBy; }
        ic.updateInternalControlCase(d, changed, c.updatedAt, u, at);
      });
      assert.equal(result.ok, true, JSON.stringify(result)); const saved = await current();
      assert.deepEqual(saved.deletion, deleted); assert.equal(saved.isClosed, closed); assert.equal(saved.events.at(-1).action, name); assert.equal(saved.events.at(-1).entry, 'internal-control');
    }
  });
  await check('task-origin-close-and-reopen-preserve-deletion-metadata', async () => {
    const deleted = (await current()).deletion;
    for (const closed of [true, false]) {
      const result = await office('soft-task-' + closed, (d, u, at) => {
        const task = d.tasks.find(t => t.id === taskId), previous = structuredClone(task);
        task.isClosed = closed; task.updatedAt = at; task.updatedBy = u.id;
        if (closed) { task.closedDate = '2026-10-03'; task.closedBy = u.id; } else { delete task.closedDate; delete task.closedBy; }
        ic.reconcileInternalControlAfterTaskSave(d, previous, task, u, at);
      });
      assert.equal(result.ok, true, JSON.stringify(result)); const saved = await current();
      assert.deepEqual(saved.deletion, deleted); assert.equal(saved.isClosed, closed); assert.equal(saved.events.at(-1).entry, 'task');
    }
  });
  await check('raw-tracking-origin-lifecycle-with-coherent-linked-endpoints-is-denied-when-archived', async () => {
    await rejectOffice('soft-tracking-origin-closed', (d, u, at) => {
      const c = d.internalControlCases.find(c => c.id === 'soft-case');
      ic.updateInternalControlCase(d, { ...c, isClosed: true, closedDate: '2026-10-03' }, c.updatedAt, u, at);
      const s = d.trackingItems.find(s => s.id === source.id), task = d.tasks.find(t => t.id === taskId);
      for (const e of [s.events.at(-1), d.internalControlCases.find(c => c.id === 'soft-case').trackingLifecycle.at(-1), task.trackingLifecycle.at(-1)]) e.entry = 'tracking';
    });
  });
  await check('restore-removes-key-preserves-approved-request-and-restores-both-statistics', async () => {
    const b = await current(), endpoints = await endpointPhysical();
    const result = await officeAction('soft-restore-approved', 'restore', [source.id], { actorId: 'qa-soft-operator' }, '恢復原記錄'); assert.equal(result.ok, true, JSON.stringify(result));
    const n = await current(); assert.equal(Object.hasOwn(n, 'deletion'), false); assert.deepEqual(n.deletionRequest, b.deletionRequest); assert.deepEqual(await endpointPhysical(), endpoints);
    assert.deepEqual(n.events.at(-1).before, value(b)); assert.deepEqual(n.events.at(-1).after, { ...value(n), reason: '恢復原記錄' });
    for (const v of [1, 2]) assert.equal((await callStats(v)).stats.summary.total, 3);
  });
  await check('reject-then-re-request-retains-event-history-and-pending-remains-included', async () => {
    assert.equal((await requestDelete('soft-request-second')).result.status, 'committed');
    const before = await current(), endpoints = await endpointPhysical();
    assert.equal((await officeAction('soft-reject', 'reject-delete', [source.id], { actorId: 'qa-soft-operator' }, '資料仍有效')).ok, true);
    const rejected = await current(); assert.equal(rejected.deletion, undefined); assert.equal(rejected.deletionRequest.status, 'rejected'); assert.equal(rejected.deletionRequest.reviewReason, '資料仍有效'); assert.deepEqual(await endpointPhysical(), endpoints);
    assert.equal((await rpc('read')).trackingItems.find(r => r.id === source.id).deletionRequest.status, 'rejected');
    assert.deepEqual(rejected.events.slice(0, before.events.length), before.events);
    assert.equal((await requestDelete('soft-request-third', [source.id], '補充後再次申請')).result.status, 'committed');
    const pending = await current(); assert.equal(pending.deletionRequest.status, 'pending'); assert.equal(pending.deletionRequest.reviewReason, undefined);
    assert.deepEqual(pending.events.at(-1).before.deletionRequest, rejected.deletionRequest);
    for (const v of [1, 2]) assert.equal((await callStats(v)).stats.summary.total, 3);
  });
  await check('ship-cannot-delete-restore-reject-and-shore-cannot-impersonate-request', async () => {
    for (const type of ['delete', 'restore', 'reject-delete']) await rejection('soft-ship-denied-' + type, rows => ({ type, items: [{ id: source.id, expectedUpdatedAt: rows.find(r => r.id === source.id).updatedAt, reason: 'forbidden' }] }));
    await rejectOffice('soft-shore-request-denied', (d, u, at) => apply(d.trackingItems.find(s => s.id === sibling.id), 'request-delete', 'wrong channel', u, at, 'soft-shore-request-denied'));
  });
  await check('readonly-and-other-vessel-shore-actors-cannot-delete-reject-or-restore', async () => {
    for (const actorId of ['qa-soft-viewer', 'qa-soft-other']) for (const action of ['delete', 'reject-delete']) {
      const name = 'soft-denied-' + actorId + action;
      await rejectOffice(name, (d, u, at) => apply(d.trackingItems.find(s => s.id === source.id), action, 'permission boundary', u, at, name), { actorId });
    }
    assert.equal((await officeAction('soft-delete-for-restore-denial', 'delete')).ok, true);
    for (const actorId of ['qa-soft-viewer', 'qa-soft-other']) await rejectOffice('soft-denied-restore-' + actorId, (d, u, at) => apply(d.trackingItems.find(s => s.id === source.id), 'restore', 'permission boundary', u, at, 'soft-denied-restore-' + actorId), { actorId });
    assert.equal((await officeAction('soft-restore-for-next', 'restore')).ok, true);
  });
  await check('closed-source-delete-and-restore-do-not-reopen-or-require-closeTasks', async () => {
    assert.equal((await submit('soft-close-active', [source.id], rows => ({ type: 'lifecycle', action: 'close', date: '2026-10-03', targets: [{ entry: 'tracking', id: source.id, expectedUpdatedAt: rows.find(s => s.id === source.id).updatedAt }] }))).result.status, 'committed');
    const endpoints = await endpointPhysical(), b = await current();
    for (const action of ['delete', 'restore']) {
      const r = await officeAction('soft-closed-' + action, action, [source.id], { actorId: 'qa-soft-operator' }); assert.equal(r.ok, true, JSON.stringify(r));
      const n = await current(); assert.equal(n.isClosed, true); assert.equal(n.closedDate, b.closedDate); assert.equal(n.closedBy, b.closedBy); assert.deepEqual(await endpointPhysical(), endpoints);
    }
    assert.equal((await submit('soft-reopen-active', [source.id], rows => ({ type: 'lifecycle', action: 'reopen', date: '', targets: [{ entry: 'tracking', id: source.id, expectedUpdatedAt: rows.find(s => s.id === source.id).updatedAt }] }))).result.status, 'committed');
  });
  await check('ship-malformed-reasons-shapes-extra-keys-stale-and-duplicate-are-atomic', async () => {
    const mutations = [i => ({ ...i, reason: '' }), i => ({ ...i, reason: ' \t\r\n ' }), i => ({ ...i, reason: 'x'.repeat(501) }), i => ({ ...i, reason: null }), i => ({ ...i, reason: 1 }), i => ({ ...i, expectedUpdatedAt: 'stale' }), i => ({ ...i, expectedUpdatedAt: null }), i => ({ ...i, deletion: {} }), i => ({ ...i, progress: 'forbidden' }), i => { const { reason, ...rest } = i; return rest; }];
    for (const [index, mutate] of mutations.entries()) await rejection('soft-malformed-' + index, rows => ({ type: 'request-delete', items: [mutate({ id: source.id, expectedUpdatedAt: rows.find(s => s.id === source.id).updatedAt, reason: 'valid' })] }));
    for (const [index, value] of [null, [], 'scalar'].entries()) await rejection('soft-invalid-item-' + index, () => ({ type: 'request-delete', items: [value] }));
    await rejection('soft-empty-items', () => ({ type: 'request-delete', items: [] }));
    await rejection('soft-extra-command-key', rows => ({ type: 'request-delete', items: [{ id: source.id, expectedUpdatedAt: rows.find(s => s.id === source.id).updatedAt, reason: 'valid' }], changes: {} }));
    await rejection('soft-duplicate-id', rows => { const i = { id: source.id, expectedUpdatedAt: rows.find(s => s.id === source.id).updatedAt, reason: 'valid' }; return { type: 'request-delete', items: [i, i] }; });
    await rejection('soft-101-items', rows => ({ type: 'request-delete', items: Array.from({ length: 101 }, () => ({ id: source.id, expectedUpdatedAt: rows.find(s => s.id === source.id).updatedAt, reason: 'valid' })) }));
  });
  await check('ship-batch-stale-and-out-of-scope-reject-then-valid-selected-only-batch-commits', async () => {
    const ids = [source.id, sibling.id];
    await rejection('soft-batch-stale', rows => ({ type: 'request-delete', items: ids.map((id, i) => ({ id, expectedUpdatedAt: i ? 'stale' : rows.find(s => s.id === id).updatedAt, reason: 'batch' })) }), ids);
    const before = await ledger(); await assert.rejects(rpc('claim', { bundleId: randomUUID(), ids, creation: false }, 'qa-v2'), /source-unavailable/); assert.deepEqual(await ledger(), before);
    const b = await qa.read(); const result = await requestDelete('soft-batch-pending', ids); assert.equal(result.result.status, 'committed', JSON.stringify(result.result));
    const n = await qa.read(); assert.equal(n.revision, b.revision + 1); assert.deepEqual(n.payload.trackingItems.filter(s => !ids.includes(s.id)), b.payload.trackingItems.filter(s => !ids.includes(s.id)));
    assert.deepEqual(n.payload.internalControlCases, b.payload.internalControlCases); assert.deepEqual(n.payload.tasks, b.payload.tasks);
    for (const id of ids) assert.equal(n.payload.trackingItems.find(s => s.id === id).deletionRequest.status, 'pending');
  });
  await check('shore-batch-source-CAS-locks-and-scope-are-all-or-none', async () => {
    const ids = [source.id, sibling.id];
    const mutate = (d, u, at) => { for (const id of ids) apply(d.trackingItems.find(s => s.id === id), 'delete', 'batch', u, at, 'soft-office-batch'); };
    await rejectOffice('soft-office-stale', mutate, { operations: ops => ops.map(o => o.kind === 'entity' && o.entityId === sibling.id ? { ...o, expected: { ...o.expected, updatedAt: 'stale' } } : o) });
    await rejectOffice('soft-office-missing-lock', mutate, { guards: gs => gs.filter(g => g.section_key !== 'tracking:' + sibling.id) });
    const original = await current(sibling.id);
    await qa.db.query("update ship_dynamics_records set value=jsonb_set(value,'{vesselId}','\"qa-v2\"') where workspace_key=$1 and collection='trackingItems' and entity_id=$2", [qa.workspace, sibling.id]);
    try { await rejectOffice('soft-office-out-of-scope-batch', mutate, { actorId: 'qa-soft-operator' }); }
    finally { await qa.db.query("update ship_dynamics_records set value=$3::jsonb where workspace_key=$1 and collection='trackingItems' and entity_id=$2", [qa.workspace, sibling.id, JSON.stringify(original)]); }
    const b = await qa.read(), endpoints = await endpointPhysical(); const result = await office('soft-office-batch', mutate, { actorId: 'qa-soft-operator' }); assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal((await qa.read()).revision, b.revision + 1); assert.deepEqual(await endpointPhysical(), endpoints);
    assert.deepEqual(await current(unselected.id), b.payload.trackingItems.find(s => s.id === unselected.id));
    assert.equal((await officeAction('soft-office-batch-restore', 'restore', ids, { actorId: 'qa-soft-operator' })).ok, true);
  });
  await check('forged-metadata-and-source-only-event-tampering-cannot-piggyback-business-or-endpoint-updates', async () => {
    const mutations = [
      (s, d) => { s.events.pop(); }, s => { s.events.at(-1).before.deletion = {}; }, s => { s.events.at(-1).after.reason = 'wrong'; }, s => { s.events.at(-1).byUserId = 'wrong'; },
      s => { s.events.at(-1).at = 'wrong'; }, s => { s.events.at(-1).id = 'wrong'; }, s => { s.events.at(-1).entry = 'task'; }, s => { s.events[0].action = 'rewritten'; },
      s => { s.updatedBy = 'wrong'; }, s => { s.description = 'mixed edit'; }, s => { s.statusLogs = []; }, s => { s.createdBy = 'wrong'; }, s => { s.deletion.extra = true; },
      s => { s.deletionRequest = { status: 'approved', reason: 'forged history' }; }, (s, d) => { d.internalControlCases.find(c => c.id === s.linkedCaseId).supplementalNotes = 'mixed endpoint'; },
      (s, d) => { d.tasks.find(t => t.id === taskId).description = 'mixed task'; }, s => { s.events.push({ action: 'delete' }); }
    ];
    for (const [i, mutate] of mutations.entries()) await rejectOffice('soft-tamper-' + i, (d, u, at) => { const s = d.trackingItems.find(s => s.id === source.id); apply(s, 'delete', 'valid reason', u, at, 'soft-tamper-' + i); mutate(s, d); });
    await rejectOffice('soft-forged-plain-metadata', (d, u, at) => { d.trackingItems.find(s => s.id === source.id).deletion = { at, byUserId: u.id, reason: 'forged' }; });
    await rejectOffice('soft-forged-plain-request', (d, u, at) => { d.trackingItems.find(s => s.id === source.id).deletionRequest = { at, byUserId: u.id, reason: 'forged', status: 'pending' }; });
    for (const action of ['restore', 'reject-delete']) await rejectOffice('soft-invalid-state-' + action, (d, u, at) => apply(d.trackingItems.find(s => s.id === source.id), action, 'invalid state', u, at, 'soft-invalid-state-' + action));
    await rejection('soft-forged-create', () => ({ type: 'create', items: [{ ...source, id: 'soft-forged-new', deletion: { at: 'forged', byUserId: 'qa-owner', reason: 'forged' } }] }), ['soft-forged-new'], true);
    await rejectOffice('soft-forged-shore-create', (d, u, at) => { d.trackingItems.push({ ...d.trackingItems.find(s => s.id === sibling.id), id: 'soft-forged-shore-new', deletion: { at, byUserId: u.id, reason: 'forged' } }); });
  });
  await check('late-receipt-fault-rolls-back-entire-request-batch-and-rejection-replays', async () => {
    await qa.db.exec("create sequence public.qa_soft_receipt_attempts; create function public.qa_soft_receipt_fault() returns trigger language plpgsql as $$ begin if new.operation_id='ship-tracking:soft-late-fault' and new.result->>'status'='committed' then perform nextval('public.qa_soft_receipt_attempts'); raise exception 'qa-soft-late-fault' using errcode='22023';end if;return new;end $$;create trigger qa_soft_receipt_fault before insert on public.ship_dynamics_record_receipts for each row execute function public.qa_soft_receipt_fault();");
    try {
      const result = await rejection('soft-late-fault', rows => ({ type: 'request-delete', items: [source.id, sibling.id].map(id => ({ id, expectedUpdatedAt: rows.find(s => s.id === id).updatedAt, reason: 'late rollback' })) }), [source.id, sibling.id]);
      assert.equal(result.code, 'qa-soft-late-fault'); assert.equal((await qa.db.query('select is_called from qa_soft_receipt_attempts')).rows[0].is_called, true);
    } finally { await qa.db.exec('drop trigger qa_soft_receipt_fault on public.ship_dynamics_record_receipts;drop function public.qa_soft_receipt_fault();drop sequence public.qa_soft_receipt_attempts;'); }
  });
  await check('shore-late-receipt-fault-rolls-back-delete-batch-and-successful-envelope-replays', async () => {
    await qa.db.exec("create sequence public.qa_soft_shore_attempts; create function public.qa_soft_shore_fault() returns trigger language plpgsql as $$ begin if new.operation_id='soft-shore-late-fault' and new.result->>'status'='committed' then perform nextval('public.qa_soft_shore_attempts'); raise exception 'qa-soft-shore-late-fault' using errcode='22023';end if;return new;end $$;create trigger qa_soft_shore_fault before insert on public.ship_dynamics_record_receipts for each row execute function public.qa_soft_shore_fault();");
    const before = await ledger();
    try {
      await assert.rejects(officeAction('soft-shore-late-fault', 'delete', [source.id, sibling.id]), /qa-soft-shore-late-fault/);
      assert.equal((await qa.db.query('select is_called from qa_soft_shore_attempts')).rows[0].is_called, true); assert.deepEqual(await ledger(), before);
      assert.equal((await qa.db.query("select count(*)::int n from ship_dynamics_record_receipts where workspace_key=$1 and operation_id='soft-shore-late-fault'", [qa.workspace])).rows[0].n, 0);
    } finally { await qa.db.exec('drop trigger qa_soft_shore_fault on public.ship_dynamics_record_receipts;drop function public.qa_soft_shore_fault();drop sequence public.qa_soft_shore_attempts;'); }
    let envelope;
    const result = await officeAction('soft-shore-replay', 'delete', [source.id, sibling.id], { actorId: 'qa-soft-operator', capture: args => { envelope = args; } }); assert.equal(result.ok, true, JSON.stringify(result));
    const frozen = await ledger();
    const replay = await qa.db.transaction(async tx => (await tx.query('select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) result', envelope)).rows[0].result);
    assert.equal(replay.replayed, true); assert.deepEqual(await ledger(), frozen);
    assert.equal((await officeAction('soft-shore-replay-restore', 'restore', [source.id, sibling.id], { actorId: 'qa-soft-operator' })).ok, true);
  });
  await check('lease-contention-expiry-bundle-CAS-and-wrong-holder-remain-authoritative', async () => {
    const before = await ledger(), block = 'qa-soft-blocker';
    await qa.db.query('select claim_ship_dynamics_edit_lock($1,$2,$3,\'QA\',75)', [qa.workspace, 'task:' + taskId, block]);
    try { const result = await rpc('claim', { bundleId: randomUUID(), ids: [source.id, sibling.id], creation: false }); assert.equal(result.ok, false); }
    finally { await qa.db.query('delete from ship_dynamics_edit_locks where workspace_key=$1 and locked_by=$2', [qa.workspace, block]); }
    assert.deepEqual(await ledger(), before);
    for (const scenario of ['expired', 'wrong-holder', 'stale-source']) {
      const bundleId = randomUUID(), claim = await rpc('claim', { bundleId, ids: [source.id], creation: false }); assert.equal(claim.ok, true);
      const saved = await current();
      try {
        if (scenario === 'expired') await qa.db.query("update ship_dynamics_edit_locks set expires_at=clock_timestamp()-interval '1 second' where workspace_key=$1 and section_key=$2", [qa.workspace, 'tracking:' + source.id]);
        if (scenario === 'stale-source') await qa.db.query("update ship_dynamics_records set value=value||'{\"supplementalNotes\":\"concurrent QA\"}'::jsonb where workspace_key=$1 and collection='trackingItems' and entity_id=$2", [qa.workspace, source.id]);
        const before = await ledger(), result = await rpc('submit', { bundleId, operationId: 'soft-' + scenario, command: { type: 'request-delete', items: [{ id: source.id, expectedUpdatedAt: claim.data.trackingItems.find(s => s.id === source.id).updatedAt, reason: 'guard' }] } }, 'qa-v1', '11111111-1111-4111-8111-111111111111', scenario === 'wrong-holder' ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : '22222222-2222-4222-8222-222222222222');
        assert.equal(result.status, 'rejected'); assert.deepEqual(await ledger(), before);
      } finally { await rpc('release', { bundleId }); if (scenario === 'stale-source') await qa.db.query("update ship_dynamics_records set value=$3::jsonb where workspace_key=$1 and collection='trackingItems' and entity_id=$2", [qa.workspace, source.id, JSON.stringify(saved)]); }
    }
  });
  await check('public-statistics-retain-strict-query-validation-and-private-table-helper-ACLs', async () => {
    for (const v of [1, 2]) {
      for (const query of [{ from: '', to: '', type: 'all', urgency: 'all', extra: true }, { from: '2026-02-30', to: '', type: 'all', urgency: 'all' }, { from: '2026-10-02', to: '2026-10-01', type: 'all', urgency: 'all' }, { from: '', to: '', type: 'unknown', urgency: 'all' }, { from: '', to: '', type: 'all', urgency: null }]) await assert.rejects(callStats(v, undefined, query), /tracking-statistics-invalid-query/);
      await assert.rejects(callStats(v, { kind: 'all', value: '', extra: true }), /tracking-statistics-invalid-query/);
    }
    await assert.rejects(callStats(1, undefined, { from: '', to: '', type: 'annual-inspection', urgency: 'all' }), /tracking-statistics-invalid-query/);
    assert.equal((await callStats(2, undefined, { from: '', to: '', type: 'annual-inspection', urgency: 'all' })).stats.summary.total, 0);
    for (const sql of ['select * from public.ship_dynamics_records', 'select * from ship_dynamics_tracking_private.bundles', "select ship_dynamics_tracking_private.deletion_value_v1('{}')"]) await assert.rejects(qa.db.transaction(async tx => { await tx.exec('set local role anon'); await tx.query(sql); }), /permission denied/);
  });
  if (!beforeUpgrade) await check('read-only-installed-hash-ACL-readback-and-tampered-helper-fail-closed', async () => {
    const before = await installLedger();
    const read = async () => { const r = await qa.db.exec(fs.readFileSync(readback, 'utf8')); return (Array.isArray(r) ? r : [r]).flatMap(v => v.rows || []).find(r => r.status); };
    const result = await read(); assert.equal(result?.status, 'PASS', JSON.stringify(result)); assert.equal(Number(result.checks), 11); assert.equal(Number(result.expected_functions), 18); evidence.readback = result;
    const signature = 'ship_dynamics_tracking_private.apply_deletion_v1(jsonb,text,text,text,text,text)', original = (await qa.db.query('select pg_get_functiondef($1::regprocedure) definition', [signature])).rows[0].definition;
    await qa.db.exec(original.replace(/begin\r?\n/, 'begin\n -- soft unknown helper QA\n'));
    try { assert.equal((await read()).status, 'FAIL'); const cat = await catalog(); await assert.rejects(qa.db.exec(sqlText(migration)), /tracking-soft-delete-predecessor-mismatch/); await qa.db.exec('rollback'); assert.deepEqual(await catalog(), cat); }
    finally { await qa.db.exec(original); }
    assert.equal((await read()).status, 'PASS'); assert.deepEqual(await installLedger(), before);
    evidence.functionHashes = (await catalog()).filter(r => changedNames.includes(r.proname));
    fs.writeFileSync(path.join(output, 'installed-readback.json'), JSON.stringify({ result, functions: evidence.functionHashes }, null, 2));
  });
} catch (error) { failure = error; evidence.error = error.stack; evidence.sqlError = { position: error.position, where: error.where, detail: error.detail }; console.error(error.stack, evidence.sqlError); }
finally {
  try {
    await qa?.close(); await native?.close();
    const ports = [Number(process.env.QA_HMR_PORT), qa?.origin ? Number(new URL(qa.origin).port) : 0].filter(Boolean);
    evidence.auxiliaryPorts = [];
    for (const port of ports) {
      const closed = await new Promise(resolve => { const s = net.connect({ host: '127.0.0.1', port }); s.once('connect', () => { s.destroy(); resolve(false); }); s.once('error', () => resolve(true)); s.setTimeout(2000, () => { s.destroy(); resolve(false); }); });
      evidence.auxiliaryPorts.push({ port, closed }); assert.equal(closed, true, 'Owned HTTP/HMR port closed');
    }
    await fs.promises.rm(path.join(output, 'vite-cache'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); evidence.ownedViteCacheRemoved = true;
  } catch (error) { failure ||= error; evidence.cleanupError = error.message; }
  evidence.status = failure ? 'FAIL' : 'PASS'; evidence.finalInputs = inputHashes();
  try { assert.deepEqual(evidence.finalInputs, evidence.inputs, 'Relevant test input bytes changed during execution'); } catch (error) { failure ||= error; evidence.inputDrift = error.message; evidence.status = 'FAIL'; }
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ status: evidence.status, output, caseCount: evidence.cases.length }));
  if (failure) process.exitCode = 1;
}
