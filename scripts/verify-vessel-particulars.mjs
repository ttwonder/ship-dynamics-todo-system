import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { createInitialData } = await server.ssrLoadModule('/src/data/seed.ts');
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
  const data = createInitialData();
  Object.assign(data.vessels[0], { yearLabel: '2021.06', tonnageLabel: '2.0萬' });
  const normalized = normalizeAppData(data);
  assert.equal(normalized.vessels[0].yearLabel, '2021.06', 'saved year label must survive cloud/import normalization');
  assert.equal(normalized.vessels[0].tonnageLabel, '2.0萬', 'saved tonnage label must survive normalization without unit conversion');
  const cleared = structuredClone(data);
  cleared.vessels[0].yearLabel = ''; cleared.vessels[0].tonnageLabel = '';
  assert.equal(normalizeAppData(cleared).vessels[0].yearLabel, '', 'an explicit clear is durable, not a missing old field');
  assert.equal(normalizeAppData(cleared).vessels[0].tonnageLabel, '');
  const legacy = structuredClone(data);
  delete legacy.vessels[0].yearLabel; delete legacy.vessels[0].tonnageLabel;
  const old = normalizeAppData(legacy).vessels[0];
  assert.equal(Object.hasOwn(old, 'yearLabel'), false, 'legacy absent labels must not be auto-populated or converted to a saved clear');
  assert.equal(Object.hasOwn(old, 'tonnageLabel'), false);
  const { vesselParticularDraft, vesselParticularReference } = await server.ssrLoadModule('/src/vesselParticulars.ts');
  const { default: reference } = await server.ssrLoadModule('/src/data/vesselParticularsReference.json');
  assert.equal(reference.rows.length, 42);
  assert.equal(new Set(reference.rows.map(row => row.englishName)).size, 42);
  for (const row of reference.rows) {
    for (const names of [{name:row.chineseName,shortName:'',fullName:''},{name:'',shortName:'',fullName:row.englishName}]) {
      assert.deepEqual(vesselParticularDraft(names), {yearLabel:row.yearLabel,tonnageLabel:row.tonnageLabel,particularsSuggested:true}, 'all reference names resolve exactly');
      assert.equal(Object.hasOwn(names,'yearLabel'), false, 'suggestions never mutate source vessels');
    }
  }
  const names = { name:'安華輪', shortName:'AMBER', fullName:'FPMC S AMBER' };
  assert.deepEqual(vesselParticularDraft({...names,yearLabel:'2024.03',tonnageLabel:'2.1萬'}), {yearLabel:'2024.03',tonnageLabel:'2.1萬',particularsSuggested:false}, 'saved values override the old reference');
  assert.deepEqual(vesselParticularDraft({...names,yearLabel:'',tonnageLabel:''}), {yearLabel:'',tonnageLabel:'',particularsSuggested:false}, 'saved clears never refill');
  assert.deepEqual(vesselParticularDraft({...names,yearLabel:''}), {yearLabel:'',tonnageLabel:'2.0萬',particularsSuggested:true}, 'suggest each missing field independently');
  assert.deepEqual(vesselParticularDraft({name:'未知船',shortName:'',fullName:''}), {yearLabel:'',tonnageLabel:'',particularsSuggested:false});
  assert.equal(vesselParticularReference({...names,fullName:'FPMC 27'}), undefined, 'conflicting exact names are not guessed');
  assert.equal(vesselParticularReference({...names,name:'',fullName:'FPMC S AMB'}), undefined, 'no prefix/fuzzy matching');
  const auth = await server.ssrLoadModule('/src/cloudAuthorization.ts');
  assert.equal(auth.vesselPatchRequiresCollaborationLock(legacy.vessels[0], data.vessels[0]), false, 'year/tonnage are Management profile fields, not an operational lease edit');
  assert.equal(auth.vesselPatchRequiresCollaborationLock(data.vessels[0], {...data.vessels[0], note:{...data.vessels[0].note,recentDynamics:'real operation'}}), true, 'operational lock rules remain unchanged');
  const authBase = structuredClone(legacy);
  authBase.users = ['owner','admin','operator'].map(role=>({...legacy.users[0],id:`part-${role}`,role,isActive:true,managedVesselIds:[legacy.vessels[0].id]}));
  const authNext = structuredClone(authBase);
  Object.assign(authNext.vessels[0],{yearLabel:'2021.06',tonnageLabel:'2.0萬'});
  for (const role of ['owner','admin']) assert.doesNotThrow(()=>auth.assertActorAuthorizedForAppDataChange(authBase,authNext,`part-${role}`));
  assert.throws(()=>auth.assertActorAuthorizedForAppDataChange(authBase,authNext,'part-operator'), auth.CloudPatchAuthorizationError, 'new particulars require manageVessels, not merely editBusinessContent');
  console.log('PASS vessel particulars: normalization, 42 references, editor-only suggestions, saved overrides/clears, name ambiguity, Management permission and operational-lock separation');
} finally { await server.close(); }
