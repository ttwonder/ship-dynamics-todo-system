import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createNativeRecordQa } from './record-storage-native-qa.mjs';
import { createRecordStorageLocalQa } from './record-storage-local-qa.mjs';
import { installTrackingBrowserMigrations } from './tracking-browser-fixture.mjs';

// Only an owned fresh loopback cluster and synthetic fixtures; no hosted endpoint.
const root = process.env.QA_EVIDENCE_ROOT;
assert.ok(root && path.isAbsolute(root), 'Absolute QA_EVIDENCE_ROOT required');
fs.mkdirSync(root, { recursive: true });
const output = fs.mkdtempSync(path.join(root, 'tracking-reclassification-native-'));
const evidence = { label: 'Native PostgreSQL / synthetic data / not production', cases: [], productionContacted: false };
const migration = 'supabase/migrations/20260928180000_tracking_reclassification.sql';
const beforeUpgrade = process.argv.includes('--before-upgrade');
const crlf = process.argv.includes('--crlf-install');
const inputPaths = [migration, 'supabase/verification/tracking-reclassification-readback.sql', 'scripts/verify-tracking-reclassification-native.mjs', 'scripts/record-storage-native-qa.mjs', 'scripts/tracking-browser-fixture.mjs', 'src/tracking/trackingReclassification.ts', 'src/tracking/trackingWorkflow.ts', 'src/tracking/trackingAuthorization.ts', 'src/tracking/trackingTypes.ts'];
const inputHashes = () => Object.fromEntries(inputPaths.filter(f => fs.existsSync(f)).map(f => [f, createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
evidence.inputs = inputHashes();
evidence.installationLineEndings = crlf ? 'CRLF' : 'LF';
const sqlText = file => fs.readFileSync(file, 'utf8').replace(/\r?\n/g, crlf ? '\r\n' : '\n');
const check = async (name, run) => { await run(); evidence.cases.push(name); console.log('PASS', name); };
const labels = { repair: '維修工程', drydock: '塢修工程', 'annual-inspection': '年檢工程', 'semiannual-materials': '半年物料', 'temporary-materials': '臨時物料', spares: '備件', 'drydock-spares': '塢修備件', 'drydock-materials': '塢修物料' };
const snapshot = s => ({ kind: s.kind, requestType: s.requestType || '', completionDate: s.completionDate || '', actualDeliveryDate: s.actualDeliveryDate || '', deliveryStatus: s.deliveryStatus });
let native, qa, failure;
try {
  native = await createNativeRecordQa(output, evidence, { httpTransactions: true });
  qa = await createRecordStorageLocalQa({ internalControl: true, browserAuthority: true, scopedRead: true, shipInternalControl: true, tracking: true, taskMember: true, databaseFactory: async () => native.adapter });
  await installTrackingBrowserMigrations(qa.db);
  // Explicit predecessor chain: this suite must test its own forward delta, not
  // silently inherit it from an evolving browser-fixture convenience installer.
  for (const name of ['20260925020000_edit_lock_holder.sql', '20260925080000_ship_tracking_public.sql', '20260925160000_tracking_field_revision.sql', '20260927130000_tracking_fleet_statistics.sql', '20260928140000_tracking_annual_types.sql']) await qa.db.exec(sqlText('supabase/migrations/' + name));
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
  const source = { id: 'reclass-source', kind: 'supply', requestType: 'spares', vesselId: 'qa-v1', referenceNo: 'QA-RECLASS-001', description: '來源手工內容', applicationDate: '2026-09-01', urgency: 'urgent', urgentSubtypes: ['manual'], progress: '初始進度', expectedDate: '2026-09-02', supplementalNotes: '保留備註', purchaseNos: '000123', deliveryStatus: 'delivered', actualDeliveryDate: '2026-09-03', completionDate: '2026-08-10', supplier: '保留供應商', contractor: '保留工程商', source: { fileName: 'synthetic.xlsx', row: 2, originalValues: { type: 'original' } } };
  const sibling = { ...source, id: 'reclass-unselected', requestType: 'temporary-materials', deliveryStatus: 'not-delivered', actualDeliveryDate: '' };
  const unselected = { ...source, id: 'reclass-never-selected', deliveryStatus: 'not-delivered', actualDeliveryDate: '' };
  const created = await submit('reclass-create', [source.id, sibling.id, unselected.id], () => ({ type: 'create', items: [source, sibling, unselected] }), true);
  assert.equal(created.result.status, 'committed');
  assert.equal((await submit('reclass-sync', [source.id], rows => ({ type: 'sync', reporterNameAndRole: 'QA／測試', items: [{ id: source.id, expectedUpdatedAt: rows.find(r => r.id === source.id).updatedAt, item: { id: 'reclass-case', reportDate: '2026-09-01', reportSource: '日常', description: '案例手工前文\n類型：備件\n實際送達/完工日期：2026-09-03\n案例手工尾文', priority: '低', category: '維修', equipmentSubcategory: '', isAware: false, status: source.progress, departments: ['督導'], expectedDate: '2026-10-02' } }] }))).result.status, 'committed');
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
        const lease = (await qa.db.query("select claim_ship_dynamics_edit_lock($1,$2,'qa-reclass-office','QA OFFICE',75) result", [qa.workspace, key])).rows[0].result;
        assert.equal(lease.ok, true, key); guards.push({ section_key: key, locked_by: lease.locked_by, lease_version: lease.lease_version });
      }
      const guard = (await qa.db.query('select ship_dynamics_actor_guard($1::jsonb,$2) result', [JSON.stringify(base), actor.id])).rows[0].result;
      return await qa.db.transaction(async tx => (await tx.query('select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) result', [qa.workspace, name, JSON.stringify(operations), 'QA OFFICE', actor.id, JSON.stringify(guard), null, JSON.stringify(options.guards ? options.guards(guards) : guards)])).rows[0].result);
    } finally { await qa.db.query("delete from ship_dynamics_edit_locks where workspace_key=$1 and locked_by='qa-reclass-office'", [qa.workspace]); }
  };
  const linked = await office('reclass-link-task', (d, u, at) => {
    const c = d.internalControlCases.find(c => c.id === 'reclass-case');
    ic.updateInternalControlCase(d, { ...c, syncToTask: true }, c.updatedAt, u, at, { categories: ['維修'], expectedDate: '2026-11-01', ownerUserIds: [u.id], isAbnormal: false });
  });
  assert.equal(linked.ok, true, JSON.stringify(linked));
  // Independently customized endpoint text is intentional; the source label is
  // replaced in each endpoint, never by copying the case body over the task.
  const taskId = (await qa.read()).payload.internalControlCases.find(c => c.id === 'reclass-case').linkedTaskId;
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
  const changedFunctions = ['ship_dynamics_tracking_validate_v1', 'plan_v1', 'submit_v1', 'request_kind_v1', 'request_label_v1', 'classification_value_v1', 'type_description_v1', 'reclassify_event_v1', 'reclassify_link_v1'];
  const catalog = async () => (await qa.db.query("select oid::text,proname,md5(replace(prosrc,chr(13)||chr(10),chr(10))) body_hash,proacl::text,prosecdef,proconfig from pg_proc where pronamespace in ('public'::regnamespace,'ship_dynamics_tracking_private'::regnamespace) and not(proname=any($1::text[])) order by oid", [changedFunctions])).rows;
  if (!beforeUpgrade) {
    await check('unknown-predecessors-rejected-before-any-install', async () => {
      for (const signature of ['public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)', 'ship_dynamics_tracking_private.plan_v1(text,text,jsonb,jsonb,text,text,text,text)', 'ship_dynamics_tracking_private.submit_v1(text,text,uuid,uuid,jsonb,boolean)']) {
        const original = (await qa.db.query('select pg_get_functiondef($1::regprocedure) definition', [signature])).rows[0].definition;
        const unknown = original.replace(/begin\r?\n/, 'begin\n -- unknown predecessor QA\n'); assert.notEqual(unknown, original);
        await qa.db.exec(unknown);
        const before = await ledger(), previous = await catalog();
        await assert.rejects(qa.db.exec(sqlText(migration)), /tracking-reclassification-predecessor-mismatch/); await qa.db.exec('rollback');
        assert.deepEqual(await ledger(), before); assert.deepEqual(await catalog(), previous);
        assert.equal((await qa.db.query("select to_regprocedure('ship_dynamics_tracking_private.reclassify_link_v1(jsonb,jsonb,jsonb,jsonb)') p")).rows[0].p, null);
        await qa.db.exec(original);
      }
    });
    await check('forward-repeat-and-opposite-newline-reapply-preserve-all-business-and-unrelated-functions', async () => {
      const before = await ledger(), previous = await catalog();
      await qa.db.exec(sqlText(migration)); await qa.db.exec(sqlText(migration));
      await qa.db.exec(fs.readFileSync(migration, 'utf8').replace(/\r?\n/g, crlf ? '\n' : '\r\n'));
      assert.deepEqual(await ledger(), before); assert.deepEqual(await catalog(), previous);
      assert.equal((await rpc('submit', created.request)).replayed, true); assert.deepEqual(await ledger(), before);
    });
  }
  const classification = await qa.loadModule('/src/tracking/trackingReclassification.ts');
  const graph = d => ({ source: d.trackingItems.find(r => r.id === source.id), item: d.internalControlCases.find(r => r.id === 'reclass-case'), task: d.tasks.find(r => r.id === taskId) });
  const classify = (d, u, at, operationId, requestType, actualDate, deliveryStatus, progress) => {
    const g = graph(d), old = structuredClone(g.source), s = g.source;
    s.kind = ['repair', 'drydock', 'annual-inspection'].includes(requestType) ? 'engineering' : 'supply'; s.requestType = requestType;
    if (s.kind === 'supply') { s.actualDeliveryDate = actualDate; s.deliveryStatus = deliveryStatus; } else s.completionDate = actualDate;
    s.updatedAt = at; s.updatedBy = u.id;
    if (progress !== undefined) {
      const log = { id: operationId + ':' + s.id + ':progress', at, by: u.name, byUserId: u.id, text: progress };
      s.progress = progress; s.statusLogs = [log, ...s.statusLogs];
      g.item.status = progress; g.item.statusLogs = [structuredClone(log), ...g.item.statusLogs];
      g.task.status = progress; g.task.statusLogs = structuredClone(g.item.statusLogs);
    }
    const event = { id: operationId + ':' + s.id + ':reclassify', operationId, action: 'reclassify', before: snapshot(old), after: snapshot(s), at, byUserId: u.id, entry: 'tracking' };
    s.events = [...(s.events || []), event];
    for (const member of [g.item, g.task]) {
      member.description = classification.reclassifyTrackingDescription(member.description, old, s);
      member.trackingLifecycle = [...(member.trackingLifecycle || []), structuredClone(event)]; member.updatedAt = at; member.updatedBy = u.id;
    }
    return g;
  };
  const correct = (requestType, actualDate, deliveryStatus, rows, id = source.id) => ({ id, expectedUpdatedAt: rows.find(r => r.id === id).updatedAt, requestType, actualDate, deliveryStatus });
  const rejection = async (name, make, ids = [source.id]) => {
    const before = await ledger(), { result, request } = await submit(name, ids, make);
    assert.equal(result.status, 'rejected', JSON.stringify(result)); assert.deepEqual(await ledger(), before);
    assert.equal((await rpc('receipt', request)).status, 'rejected');
    return result;
  };
  await check('ship-dedicated-cross-kind-linked-triple-preserves-identity-and-manual-fields', async () => {
    const before = await qa.read(), old = before.payload.trackingItems.find(r => r.id === source.id);
    const { result, request } = await submit('reclass-ship-engineering', [source.id], rows => ({ type: 'reclassify', items: [{ id: source.id, expectedUpdatedAt: rows.find(r => r.id === source.id).updatedAt, requestType: 'annual-inspection', actualDate: '2026-09-28', deliveryStatus: old.deliveryStatus }] }));
    assert.equal(result.status, 'committed', JSON.stringify(result));
    const after = await qa.read(), saved = after.payload.trackingItems.find(r => r.id === source.id);
    assert.equal(saved.kind, 'engineering'); assert.equal(saved.requestType, 'annual-inspection'); assert.equal(saved.completionDate, '2026-09-28');
    assert.equal(saved.actualDeliveryDate, old.actualDeliveryDate); assert.equal(saved.deliveryStatus, old.deliveryStatus);
    const event = saved.events.at(-1);
    assert.deepEqual(event.before, snapshot(old)); assert.deepEqual(event.after, snapshot(saved)); assert.equal(event.action, 'reclassify'); assert.equal(event.id, request.operationId + ':' + source.id + ':reclassify');
    for (const [collection, id, expectedText] of [['internalControlCases', 'reclass-case', '案例手工前文\n類型：年檢工程\n實際送達/完工日期：2026-09-28\n案例手工尾文\n\n報告人姓名＋職務：QA／測試'], ['tasks', taskId, '<p>任務手工前文</p><p>類型：年檢工程</p><p>實際送達/完工日期：2026-09-28</p><p>任務手工尾文</p>']]) {
      const b = before.payload[collection].find(r => r.id === id), n = after.payload[collection].find(r => r.id === id);
      assert.equal(n.description, expectedText); assert.deepEqual(n.trackingLifecycle, [...(b.trackingLifecycle || []), event]);
      const omit = o => Object.fromEntries(Object.entries(o).filter(([k]) => !['description', 'trackingLifecycle', 'updatedAt', 'updatedBy'].includes(k)));
      assert.deepEqual(omit(n), omit(b));
    }
    const omit = o => Object.fromEntries(Object.entries(o).filter(([k]) => !['kind', 'requestType', 'completionDate', 'events', 'updatedAt', 'updatedBy'].includes(k)));
    assert.deepEqual(omit(saved), omit(old)); assert.equal(after.revision, before.revision + 1);
    for (const collection of ['trackingItems', 'internalControlCases', 'tasks']) assert.deepEqual(after.payload[collection].map(r => r.id), before.payload[collection].map(r => r.id));
    assert.deepEqual(after.payload.trackingItems.find(r => r.id === sibling.id), before.payload.trackingItems.find(r => r.id === sibling.id));
    assert.equal((await rpc('submit', request)).replayed, true); assert.deepEqual(await qa.read(), after);
  });
  await check('description-helper-TS-SQL-exact-first-match-plain-HTML-legacy-and-historical-date-parity', async () => {
    let comparisons = 0;
    for (const oldType of [undefined, ...Object.keys(labels)]) for (const newType of Object.keys(labels)) {
      const b = { ...source, requestType: oldType, kind: ['repair', 'drydock', 'annual-inspection'].includes(oldType) ? 'engineering' : 'supply', completionDate: '2026-09-03' };
      for (const actualDate of ['', '2026-09-28']) {
        const n = { ...b, requestType: newType, kind: ['repair', 'drydock', 'annual-inspection'].includes(newType) ? 'engineering' : 'supply', actualDeliveryDate: actualDate, completionDate: actualDate };
        const old = labels[oldType] || '手工未分類';
        for (const text of ['', `前\r\n類型：${old}\r\n類型：${old}\r\n實際送達/完工日期：2026-09-03\r\n尾`, `<p>前</p><p>類型：${old}</p><p>實際送達/完工日期：2026-09-03</p><p>尾</p>`, `手工類型：${old}描述\n類型：${old} 手工後綴\n實際送達/完工日期：2026-09-03 手工後綴`, '<DIV class="keep">手工</DIV>', '<br/>手工', '<paragraph>不是段落標籤</paragraph>']) {
          const actual = (await qa.db.query('select ship_dynamics_tracking_private.type_description_v1($1,$2::jsonb,$3::jsonb) value', [text, JSON.stringify(b), JSON.stringify(n)])).rows[0].value;
          assert.equal(actual, classification.reclassifyTrackingDescription(text, b, n), JSON.stringify({ oldType, newType, text, actualDate })); comparisons++;
        }
      }
    }
    evidence.descriptionParityComparisons = comparisons;
  });
  await check('reverse-correction-retains-inactive-completion-and-relabels-old-date-as-historical', async () => {
    const before = graph((await qa.read()).payload);
    const { result } = await submit('reclass-ship-supply', [source.id], rows => ({ type: 'reclassify', items: [correct('drydock-materials', '', 'partially-delivered', rows)] }));
    assert.equal(result.status, 'committed', JSON.stringify(result));
    const after = graph((await qa.read()).payload);
    assert.equal(after.source.completionDate, before.source.completionDate); assert.equal(after.source.actualDeliveryDate, ''); assert.equal(after.source.deliveryStatus, 'partially-delivered');
    for (const name of ['item', 'task']) {
      assert.ok(after[name].description.includes('原工程完工日期（分類修正前）：2026-09-28')); assert.ok(!after[name].description.includes('實際送達/完工日期：'));
      assert.equal(after[name].expectedDate, before[name].expectedDate);
    }
  });
  await check('same-type-dedicated-date-status-appends-identical-linked-events-without-label-rewrite', async () => {
    const before = graph((await qa.read()).payload);
    assert.equal((await submit('reclass-same-type-date', [source.id], rows => ({ type: 'reclassify', items: [correct('drydock-materials', '2026-09-29', 'delivered', rows)] }))).result.status, 'committed');
    const after = graph((await qa.read()).payload);
    for (const name of ['item', 'task']) { assert.equal(after[name].description, before[name].description); assert.deepEqual(after[name].trackingLifecycle, [...before[name].trackingLifecycle, after.source.events.at(-1)]); }
    assert.equal(after.source.completionDate, before.source.completionDate); assert.equal(after.source.actualDeliveryDate, '2026-09-29');
  });
  await check('ordinary-same-kind-edit-classification-progress-delivery-combination-is-canonical-and-ordered', async () => {
    const before = graph((await qa.read()).payload);
    const { result } = await submit('reclass-edit-combination', [source.id], rows => ({ type: 'edit', items: [{ id: source.id, expectedUpdatedAt: rows.find(r => r.id === source.id).updatedAt, changes: { requestType: 'drydock-spares', actualDeliveryDate: '2026-09-30', progress: '普通編輯同步進度', description: '新來源內文不覆蓋下游', purchaseNos: '000999' } }] }));
    assert.equal(result.status, 'committed', JSON.stringify(result));
    const after = graph((await qa.read()).payload);
    assert.deepEqual(after.source.events.slice(before.source.events.length).map(e => e.action), ['delivery', 'reclassify']);
    assert.equal(after.source.events.at(-1).before.actualDeliveryDate, '2026-09-29'); assert.equal(after.source.events.at(-1).after.actualDeliveryDate, '2026-09-30');
    for (const name of ['item', 'task']) { assert.equal(after[name].description, classification.reclassifyTrackingDescription(before[name].description, before.source, after.source)); assert.equal(after[name].status, after.source.progress); assert.equal(after[name].expectedDate, before[name].expectedDate); }
    assert.deepEqual(after.task.statusLogs, after.item.statusLogs);
    const saved = await ledger();
    await rejection('reclass-ordinary-cross-kind', rows => ({ type: 'edit', items: [{ id: source.id, expectedUpdatedAt: rows.find(r => r.id === source.id).updatedAt, changes: { requestType: 'repair' } }] }));
    await rejection('reclass-ordinary-kind-field', rows => ({ type: 'edit', items: [{ id: source.id, expectedUpdatedAt: rows.find(r => r.id === source.id).updatedAt, changes: { kind: 'engineering', requestType: 'repair' } }] }));
    assert.deepEqual(await ledger(), saved);
  });
  await check('shore-edit-only-operator-classification-plus-progress-not-close-capability', async () => {
    const baseline = (await qa.read()).payload, owner = baseline.users.find(u => u.role === 'owner');
    const operator = { ...owner, id: 'qa-reclass-operator', name: 'QA EDIT ONLY', username: 'qa-reclass-operator', role: 'operator', managedVesselIds: ['qa-v1'] };
    await qa.db.query("insert into ship_dynamics_records(workspace_key,collection,entity_id,value,revision) values($1,'users',$2,$3::jsonb,1)", [qa.workspace, operator.id, JSON.stringify(operator)]);
    await qa.db.query("update ship_dynamics_record_collections set ids=ids||jsonb_build_array($2::text) where workspace_key=$1 and collection='users'", [qa.workspace, operator.id]);
    await qa.db.query("update ship_dynamics_record_workspaces set root=jsonb_set(root,'{settings,rolePermissions,operator}',coalesce(root#>'{settings,rolePermissions,operator}','{}')||'{\"viewAllVessels\":true,\"editBusinessContent\":true,\"closeTasks\":false}'::jsonb) where workspace_key=$1", [qa.workspace]);
    const base = (await qa.read()).payload, guard = (await qa.db.query('select ship_dynamics_actor_guard($1::jsonb,$2) g', [JSON.stringify(base), operator.id])).rows[0].g;
    assert.equal(guard.effectivePermissions.editBusinessContent, true); assert.equal(guard.effectivePermissions.closeTasks, false);
    const before = graph(base);
    const result = await office('reclass-office-operator', (d, u, at) => classify(d, u, at, 'reclass-office-operator', 'spares', before.source.actualDeliveryDate, before.source.deliveryStatus, 'edit-only 分類與進度'), { actorId: operator.id });
    assert.equal(result.ok, true, JSON.stringify(result));
    const after = graph((await qa.read()).payload); assert.equal(after.source.requestType, 'spares'); assert.equal(after.task.status, 'edit-only 分類與進度');
    const ledgerBefore = await ledger();
    const invalid = await office('reclass-office-operator-close', (d, u, at) => { const g = classify(d, u, at, 'reclass-office-operator-close', 'drydock-spares', after.source.actualDeliveryDate, after.source.deliveryStatus, '不得結案'); for (const member of Object.values(g)) { member.isClosed = true; member.closedDate = '2026-09-30'; member.closedBy = u.id; } }, { actorId: operator.id });
    assert.equal(invalid.ok, false); assert.deepEqual(await ledger(), ledgerBefore);
    evidence.editOnlyOperator = { accepted: result.ok, closureRejected: invalid.code, editBusinessContent: guard.effectivePermissions.editBusinessContent, closeTasks: guard.effectivePermissions.closeTasks };
  });
  await check('shore-cross-kind-raw-valid-plan-commits-with-exact-linked-readback', async () => {
    const before = graph((await qa.read()).payload);
    const result = await office('reclass-office-cross', (d, u, at) => classify(d, u, at, 'reclass-office-cross', 'repair', '', before.source.deliveryStatus));
    assert.equal(result.ok, true, JSON.stringify(result));
    const after = graph((await qa.read()).payload);
    assert.equal(after.source.kind, 'engineering'); assert.equal(after.source.completionDate, ''); assert.equal(after.source.actualDeliveryDate, before.source.actualDeliveryDate);
    for (const name of ['item', 'task']) assert.deepEqual(after[name].trackingLifecycle, [...before[name].trackingLifecycle, after.source.events.at(-1)]);
  });
  await check('engineering-ordinary-edit-completion-event-precedes-reclassification-and-unchanged-type-does-not-propagate', async () => {
    const before = graph((await qa.read()).payload);
    assert.equal((await submit('reclass-engineering-edit', [source.id], rows => ({ type: 'edit', items: [{ id: source.id, expectedUpdatedAt: rows.find(r => r.id === source.id).updatedAt, changes: { requestType: 'annual-inspection', completionDate: '2026-10-01', progress: '工程編輯進度' } }] }))).result.status, 'committed');
    const after = graph((await qa.read()).payload);
    assert.deepEqual(after.source.events.slice(before.source.events.length).map(e => e.action), ['completion', 'reclassify']);
    assert.equal((await submit('reclass-type-unchanged', [source.id], rows => ({ type: 'edit', items: [{ id: source.id, expectedUpdatedAt: rows.find(r => r.id === source.id).updatedAt, changes: { requestType: 'annual-inspection', completionDate: '2026-10-02' } }] }))).result.status, 'committed');
    const current = graph((await qa.read()).payload); assert.deepEqual(current.item, after.item); assert.deepEqual(current.task, after.task); assert.equal(current.source.events.at(-1).action, 'completion');
  });
  await check('ship-malformed-stale-enum-date-status-and-extra-fields-are-zero-business-write', async () => {
    const bad = [
      i => ({ ...i, requestType: 'unknown' }), i => ({ ...i, actualDate: '2026-02-30' }), i => ({ ...i, actualDate: null }), i => ({ ...i, deliveryStatus: 'unknown' }),
      i => ({ ...i, deliveryStatus: 'not-delivered' }), i => ({ ...i, expectedUpdatedAt: 'stale' }), i => ({ ...i, expectedUpdatedAt: null }),
      i => ({ ...i, kind: 'supply' }), i => ({ ...i, description: 'forbidden' }), i => ({ ...i, progress: 'forbidden' }), i => ({ ...i, actualDeliveryDate: '' }),
      i => { const { actualDate, ...missing } = i; return missing; }, i => { const { requestType, ...missing } = i; return missing; },
      i => ({ ...i, requestType: 'spares', actualDate: '', deliveryStatus: 'delivered' }), i => ({ ...i, requestType: 'spares', actualDate: '2026-10-02', deliveryStatus: 'partially-delivered' })
    ];
    for (const [i, mutate] of bad.entries()) await rejection('reclass-bad-' + i, rows => ({ type: 'reclassify', items: [mutate(correct('drydock', '', 'delivered', rows))] }));
    for (const [i, value] of [null, [], 'scalar'].entries()) await rejection('reclass-item-shape-' + i, () => ({ type: 'reclassify', items: [value] }));
    await rejection('reclass-command-extra', rows => ({ type: 'reclassify', items: [correct('drydock', '', 'delivered', rows)], changes: {} }));
    await rejection('reclass-duplicate', rows => { const i = correct('drydock', '', 'delivered', rows); return { type: 'reclassify', items: [i, i] }; });
    await rejection('reclass-empty', () => ({ type: 'reclassify', items: [] }));
  });
  await check('shore-no-event-wrong-snapshot-actor-clock-identity-history-manual-field-and-linked-tamper-rejected', async () => {
    const bad = [
      g => { g.source.events.pop(); }, g => { g.source.events.at(-1).before.kind = 'wrong'; }, g => { g.source.events.at(-1).after.actualDeliveryDate = 'wrong'; },
      g => { g.source.events.at(-1).before.extra = ''; }, g => { g.source.events.at(-1).byUserId = 'wrong'; }, g => { g.source.events.at(-1).at = 'wrong'; },
      g => { g.source.events.at(-1).id = 'wrong'; }, g => { g.source.events.at(-1).operationId = ''; }, g => { g.source.events.at(-1).entry = 'task'; },
      g => { g.source.events[0].action = 'rewritten'; }, g => { g.source.statusLogs = []; }, g => { g.source.createdBy = 'wrong'; }, g => { g.source.description = 'cross-kind cannot replace manual content'; },
      g => { g.source.completionDate = ''; }, g => { g.source.linkState = 'invalid'; }, g => { g.source.vesselId = 'qa-v2'; },
      g => { g.item.description = 'stale manual replacement'; }, g => { g.task.description = g.item.description; }, g => { g.item.trackingLifecycle.pop(); }, g => { g.task.trackingLifecycle.at(-1).after.kind = 'wrong'; },
      g => { g.item.expectedDate = ''; }, g => { g.task.categories = []; }, g => { g.item.category = '其他'; }, g => { g.task.ownerUserIds = []; },
      g => { g.item.status = 'not source progress'; }, g => { g.task.statusLogs = []; }, g => { g.task.departments = []; }, g => { g.source.deliveryStatus = 'partially-delivered'; }
    ];
    for (const [i, mutate] of bad.entries()) {
      const before = await ledger();
      const result = await office('reclass-shore-tamper-' + i, (d, u, at) => { const g = classify(d, u, at, 'reclass-shore-tamper-' + i, 'spares', '2026-10-03', 'delivered'); mutate(g); });
      assert.equal(result.ok, false, 'tamper ' + i + ': ' + JSON.stringify(result)); assert.deepEqual(await ledger(), before, 'tamper ' + i);
    }
  });
  await check('shore-same-kind-event-and-single-progress-log-cannot-mask-extra-linked-or-source-changes', async () => {
    const current = graph((await qa.read()).payload);
    for (const [name, requestType, progress, mutate] of [
      ['no-event', 'drydock', undefined, g => g.source.events.pop()],
      ['late-event', 'drydock', undefined, g => g.source.events.push({ action: 'completion', byUserId: g.source.updatedBy })],
      ['extra-log', 'drydock', 'one new progress only', g => g.source.statusLogs.splice(1, 0, { ...g.source.statusLogs[0], id: 'forged-second-log' })],
      ['extra-case-field', 'drydock', 'preserve case DL', g => { g.item.expectedDate = ''; }],
      ['stale-label', 'drydock', 'must converge', g => { g.task.description = current.task.description; }],
      ['same-type-manual', current.source.requestType, undefined, g => { g.source.description = 'dedicated operation cannot edit source text'; }],
      ['same-type-other-date', current.source.requestType, undefined, g => { g.source.actualDeliveryDate = ''; }]
    ]) {
      const before = await ledger();
      const result = await office('reclass-narrow-' + name, (d, u, at) => { const g = classify(d, u, at, 'reclass-narrow-' + name, requestType, current.source.completionDate, current.source.deliveryStatus, progress); mutate(g); });
      assert.equal(result.ok, false, name + ': ' + JSON.stringify(result)); assert.deepEqual(await ledger(), before);
    }
  });
  await check('source-case-task-CAS-and-each-required-lock-are-independent-reject-boundaries', async () => {
    for (const collection of ['trackingItems', 'internalControlCases', 'tasks']) {
      const before = await ledger();
      const result = await office('reclass-stale-' + collection, (d, u, at) => classify(d, u, at, 'reclass-stale-' + collection, 'spares', '', 'not-delivered'), { operations: ops => ops.map(o => o.collection === collection && o.kind === 'entity' ? { ...o, expected: { ...o.expected, updatedAt: 'stale' } } : o) });
      assert.equal(result.ok, false); assert.equal(result.code, 'block-conflict'); assert.deepEqual(await ledger(), before);
    }
    for (const prefix of ['tracking:', 'internal-control:', 'task:']) {
      const before = await ledger();
      const result = await office('reclass-missing-lock-' + prefix, (d, u, at) => classify(d, u, at, 'reclass-missing-lock-' + prefix, 'spares', '', 'not-delivered'), { guards: guards => guards.filter(g => !g.section_key.startsWith(prefix)) });
      assert.equal(result.ok, false); assert.deepEqual(await ledger(), before);
    }
    for (const [collection, id] of [['trackingItems', source.id], ['internalControlCases', 'reclass-case'], ['tasks', taskId]]) {
      const bundleId = randomUUID(), claimed = await rpc('claim', { bundleId, ids: [source.id], creation: false }); assert.equal(claimed.ok, true);
      const row = (await qa.db.query('select value from ship_dynamics_records where workspace_key=$1 and collection=$2 and entity_id=$3', [qa.workspace, collection, id])).rows[0].value;
      await qa.db.query("update ship_dynamics_records set value=value||'{\"supplementalNotes\":\"concurrent QA write\"}'::jsonb where workspace_key=$1 and collection=$2 and entity_id=$3", [qa.workspace, collection, id]);
      try {
        const before = await ledger(), result = await rpc('submit', { operationId: 'reclass-bundle-stale-' + collection, bundleId, command: { type: 'reclassify', items: [correct('spares', '', 'not-delivered', claimed.data.trackingItems)] } });
        assert.equal(result.code, 'ship-tracking-revision-conflict'); assert.deepEqual(await ledger(), before);
      } finally { await rpc('release', { bundleId }); await qa.db.query('update ship_dynamics_records set value=$4::jsonb where workspace_key=$1 and collection=$2 and entity_id=$3', [qa.workspace, collection, id, JSON.stringify(row)]); }
    }
  });
  await check('linked-task-lock-contention-claim-is-all-or-none-and-expired-bundle-cannot-submit', async () => {
    await qa.db.query("select claim_ship_dynamics_edit_lock($1,$2,'qa-reclass-blocker','QA',75)", [qa.workspace, 'task:' + taskId]);
    const bundleId = randomUUID(), before = await ledger();
    try { const result = await rpc('claim', { bundleId, ids: [source.id, sibling.id], creation: false }); assert.equal(result.ok, false); assert.equal(result.code, 'locked'); }
    finally { await qa.db.query("delete from ship_dynamics_edit_locks where workspace_key=$1 and locked_by='qa-reclass-blocker'", [qa.workspace]); }
    assert.deepEqual(await ledger(), before);
    assert.equal((await qa.db.query('select count(*)::int n from ship_dynamics_tracking_private.bundles where workspace=$1 and bundle_id=$2::uuid', [qa.workspace, bundleId])).rows[0].n, 0);
    const fresh = randomUUID(), claim = await rpc('claim', { bundleId: fresh, ids: [source.id], creation: false }); assert.equal(claim.ok, true);
    await qa.db.query("update ship_dynamics_edit_locks set expires_at=clock_timestamp()-interval '1 second' where workspace_key=$1 and section_key=$2", [qa.workspace, 'task:' + taskId]);
    const result = await rpc('submit', { operationId: 'reclass-expired', bundleId: fresh, command: { type: 'reclassify', items: [correct('spares', '', 'not-delivered', claim.data.trackingItems)] } });
    assert.equal(result.status, 'rejected'); assert.equal(result.code, 'ship-tracking-lease-expired'); assert.deepEqual(await ledger(), before); await rpc('release', { bundleId: fresh });
  });
  await check('batch-valid-plus-stale-is-all-or-none-then-valid-batch-commits-one-revision', async () => {
    const ids = [source.id, sibling.id];
    await rejection('reclass-batch-stale', rows => ({ type: 'reclassify', items: ids.map((id, index) => ({ ...correct('annual-inspection', '', rows.find(r => r.id === id).deliveryStatus, rows, id), ...(index ? { expectedUpdatedAt: 'stale' } : {}) })) }), ids);
    const before = await qa.read();
    const { result } = await submit('reclass-batch-valid', ids, rows => ({ type: 'reclassify', items: ids.map(id => correct('annual-inspection', '', rows.find(r => r.id === id).deliveryStatus, rows, id)) }));
    assert.equal(result.status, 'committed', JSON.stringify(result)); const after = await qa.read(); assert.equal(after.revision, before.revision + 1);
    for (const id of ids) { const s = after.payload.trackingItems.find(r => r.id === id); assert.equal(s.kind, 'engineering'); assert.equal(s.completionDate, ''); }
    assert.deepEqual(after.payload.trackingItems.filter(r => !ids.includes(r.id)), before.payload.trackingItems.filter(r => !ids.includes(r.id)));
    assert.equal(after.payload.trackingItems.find(r => r.id === unselected.id).requestType, 'spares');
  });
  await check('late-receipt-fault-rolls-back-source-case-task-history-and-revision', async () => {
    await qa.db.exec("create sequence public.qa_reclass_receipt_attempts; create function public.qa_reclass_receipt_fault() returns trigger language plpgsql as $$ begin if new.operation_id='ship-tracking:reclass-late-fault' and new.result->>'status'='committed' then perform nextval('public.qa_reclass_receipt_attempts'); raise exception 'qa-reclass-late-fault' using errcode='22023';end if;return new;end $$;create trigger qa_reclass_receipt_fault before insert on public.ship_dynamics_record_receipts for each row execute function public.qa_reclass_receipt_fault();");
    try {
      const result = await rejection('reclass-late-fault', rows => ({ type: 'reclassify', items: [correct('spares', '', 'not-delivered', rows), correct('repair', '2026-10-04', rows.find(r => r.id === sibling.id).deliveryStatus, rows, sibling.id)] }), [source.id, sibling.id]);
      assert.equal(result.code, 'qa-reclass-late-fault'); assert.equal((await qa.db.query('select last_value::int n,is_called from qa_reclass_receipt_attempts')).rows[0].is_called, true);
    } finally { await qa.db.exec('drop trigger qa_reclass_receipt_fault on public.ship_dynamics_record_receipts;drop function public.qa_reclass_receipt_fault();drop sequence public.qa_reclass_receipt_attempts;'); }
  });
  await check('closed-source-case-task-cannot-reclassify-and-reopen-preserves-history', async () => {
    assert.equal((await submit('reclass-close', [source.id], rows => ({ type: 'lifecycle', action: 'close', date: '2026-10-05', targets: [{ entry: 'tracking', id: source.id, expectedUpdatedAt: rows.find(r => r.id === source.id).updatedAt }] }))).result.status, 'committed');
    await rejection('reclass-closed', rows => ({ type: 'reclassify', items: [correct('spares', '', 'not-delivered', rows)] }));
    const before = await ledger(); const result = await office('reclass-shore-closed', (d, u, at) => classify(d, u, at, 'reclass-shore-closed', 'spares', '', 'not-delivered')); assert.equal(result.ok, false); assert.deepEqual(await ledger(), before);
    assert.equal((await submit('reclass-reopen', [source.id], rows => ({ type: 'lifecycle', action: 'reopen', date: '', targets: [{ entry: 'tracking', id: source.id, expectedUpdatedAt: rows.find(r => r.id === source.id).updatedAt }] }))).result.status, 'committed');
    const g = graph((await qa.read()).payload); assert.ok(g.source.events.some(e => e.action === 'close')); assert.ok(g.task.trackingLifecycle.some(e => e.action === 'close'));
    for (const [collection, id] of [['internalControlCases', 'reclass-case'], ['tasks', taskId]]) {
      const original = (await qa.db.query('select value from ship_dynamics_records where workspace_key=$1 and collection=$2 and entity_id=$3', [qa.workspace, collection, id])).rows[0].value;
      await qa.db.query("update ship_dynamics_records set value=value||'{\"isClosed\":true,\"closedDate\":\"2026-10-05\"}'::jsonb where workspace_key=$1 and collection=$2 and entity_id=$3", [qa.workspace, collection, id]);
      try { const baseline = await ledger(); await assert.rejects(rpc('claim', { bundleId: randomUUID(), ids: [source.id], creation: false }), /lifecycle-inconsistent/); const raw = await office('reclass-closed-' + collection, (d, u, at) => classify(d, u, at, 'reclass-closed-' + collection, 'spares', '', 'not-delivered')); assert.equal(raw.ok, false); assert.deepEqual(await ledger(), baseline); }
      finally { await qa.db.query('update ship_dynamics_records set value=$4::jsonb where workspace_key=$1 and collection=$2 and entity_id=$3', [qa.workspace, collection, id, JSON.stringify(original)]); }
    }
  });
  await check('all-eight-request-types-and-legacy-missing-type-correct-without-recreation', async () => {
    await qa.db.query("update ship_dynamics_records set value=value-'requestType' where workspace_key=$1 and collection='trackingItems' and entity_id=$2", [qa.workspace, sibling.id]);
    let first = true;
    for (const requestType of Object.keys(labels)) {
      const before = (await qa.read()).payload.trackingItems.find(r => r.id === sibling.id);
      const result = await submit('reclass-eight-' + requestType, [sibling.id], rows => ({ type: 'reclassify', items: [correct(requestType, '', before.deliveryStatus, rows, sibling.id)] }));
      assert.equal(result.result.status, 'committed', JSON.stringify(result.result));
      const saved = (await qa.read()).payload.trackingItems.find(r => r.id === sibling.id); assert.equal(saved.createdAt, before.createdAt); assert.equal(saved.createdBy, before.createdBy); assert.equal(saved.events.length, before.events.length + 1);
      if (first) { assert.equal(saved.events.at(-1).before.requestType, ''); first = false; }
    }
  });
  await check('corrected-statistics-use-current-kind-and-target-date-not-inactive-fields', async () => {
    const callStats = type => qa.db.transaction(async tx => { await tx.exec('set local role anon'); return (await tx.query('select read_ship_dynamics_tracking_statistics_public_v2($1,$2::jsonb,$3::jsonb) r', [qa.workspace, JSON.stringify({ kind: 'vessel', value: 'qa-v1' }), JSON.stringify({ from: '', to: '', type, urgency: 'all' })])).rows[0].r; });
    const before = await callStats('annual-inspection'); assert.equal(before.stats.summary.total, 1); assert.equal(before.stats.summary.completed, 0);
    assert.equal((await submit('reclass-stats-correction', [source.id], rows => ({ type: 'reclassify', items: [correct('drydock-materials', '2026-10-05', 'delivered', rows)] }))).result.status, 'committed');
    const annual = await callStats('annual-inspection'), materials = await callStats('materials'), all = await callStats('all');
    assert.equal(annual.stats.summary.total, 0); assert.equal(materials.stats.summary.total, 2); assert.equal(materials.stats.summary.completed, 1); assert.equal(all.stats.summary.total, 3);
    evidence.statistics = { beforeAnnual: before.stats.summary.total, afterAnnual: annual.stats.summary.total, materials: materials.stats.summary.total, completedMaterials: materials.stats.summary.completed };
  });
  await check('public-projection-ACLs-wrong-scope-owner-and-edit-permission-still-fail-closed', async () => {
    const data = await rpc('read'); assert.equal(data.tasks, undefined); const c = data.cases.find(c => c.id === 'reclass-case'); assert.equal(c.syncToTask, false); assert.equal(c.linkedTaskId, undefined); assert.equal(c.trackingLifecycle, undefined);
    assert.equal((await rpc('read', {}, 'qa-v2')).trackingItems.some(r => r.id === source.id), false);
    await assert.rejects(rpc('claim', { bundleId: randomUUID(), ids: [source.id], creation: false }, 'qa-v2'), /source-unavailable/);
    for (const sql of ['select * from public.ship_dynamics_records', 'select ship_dynamics_tracking_private.request_kind_v1(\'repair\')', 'select * from ship_dynamics_tracking_private.bundles']) await assert.rejects(qa.db.transaction(async tx => { await tx.exec('set local role anon'); await tx.query(sql); }), /permission denied/);
    const bundleId = randomUUID(), claimed = await rpc('claim', { bundleId, ids: [source.id], creation: false }), baseline = await ledger(); assert.equal(claimed.ok, true);
    const bad = await rpc('submit', { operationId: 'reclass-other-holder', bundleId, command: { type: 'reclassify', items: [correct('repair', '', 'delivered', claimed.data.trackingItems)] } }, 'qa-v1', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); assert.equal(bad.status, 'rejected'); assert.deepEqual(await ledger(), baseline); await rpc('release', { bundleId });
    await qa.db.query("update ship_dynamics_record_workspaces set root=jsonb_set(root,'{settings,rolePermissions,operator,editBusinessContent}','false') where workspace_key=$1", [qa.workspace]);
    const before = await ledger(); const denied = await office('reclass-no-edit', (d, u, at) => classify(d, u, at, 'reclass-no-edit', 'repair', '', 'delivered'), { actorId: 'qa-reclass-operator' }); assert.equal(denied.ok, false); assert.equal(denied.code, 'tracking-permission-denied'); assert.deepEqual(await ledger(), before);
  });
  if (!beforeUpgrade) await check('read-only-catalog-hash-and-grant-readback-with-tampered-helper-negative', async () => {
    const readback = 'supabase/verification/tracking-reclassification-readback.sql', before = await ledger();
    const read = async () => { const value = await qa.db.exec(fs.readFileSync(readback, 'utf8')); return (Array.isArray(value) ? value : [value]).flatMap(r => r.rows || []).find(r => r.status); };
    const result = await read(); assert.equal(result?.status, 'PASS', JSON.stringify(result)); evidence.readback = result;
    const signature = 'ship_dynamics_tracking_private.reclassify_link_v1(jsonb,jsonb,jsonb,jsonb)', original = (await qa.db.query('select pg_get_functiondef($1::regprocedure) definition', [signature])).rows[0].definition;
    await qa.db.exec(original.replace(/begin\r?\n/, 'begin\n -- unknown helper QA\n'));
    try { assert.equal((await read()).status, 'FAIL'); await assert.rejects(qa.db.exec(sqlText(migration)), /tracking-reclassification-predecessor-mismatch/); await qa.db.exec('rollback'); }
    finally { await qa.db.exec(original); }
    assert.equal((await read()).status, 'PASS'); assert.deepEqual(await ledger(), before);
  });
} catch (error) { failure = error; evidence.error = error.stack; console.error(error.stack); }
finally {
  try { await qa?.close(); await native?.close(); } catch (error) { failure ||= error; evidence.cleanupError = error.message; }
  evidence.status = failure ? 'FAIL' : 'PASS';
  evidence.finalInputs = inputHashes();
  try { assert.deepEqual(evidence.finalInputs, evidence.inputs, 'Relevant test input bytes changed during execution'); } catch (error) { failure ||= error; evidence.inputDrift = error.message; evidence.status = 'FAIL'; }
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ status: evidence.status, output, caseCount: evidence.cases.length }));
  if (failure) process.exitCode = 1;
}
