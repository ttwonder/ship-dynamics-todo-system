import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/NormalizedApp.tsx', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../src/normalizedRuntime.ts', import.meta.url), 'utf8');

assert.match(
  app,
  /selected\?\.loginMode\s*!==\s*['"]passwordless['"]/,
  'login UI must require a personal password only when the selected directory mode requires it',
);
assert.match(
  app,
  /disabled=\{[^}]*selected\?\.loginMode\s*===\s*['"]passwordless['"][^}]*\}/,
  'password input must be disabled for a passwordless legacy account',
);
assert.match(
  app,
  /passwordRequired\s*&&\s*!password/,
  'login button must allow a selected passwordless account with an empty password',
);
assert.match(
  app,
  /免密碼登入/,
  'passwordless users need an explicit compatibility label',
);
assert.match(
  runtime,
  /person\.loginMode\s*===\s*['"]supabase['"][\s\S]*signInWithDirectoryPassword[\s\S]*signInWithLegacyCompatibility/,
  'runtime must route Owner/native accounts separately from legacy-password and passwordless accounts',
);
assert.match(
  runtime,
  /#directoryPasswordChange\s*=\s*person\.loginMode\s*===\s*['"]supabase['"]\s*&&\s*person\.mustChangePassword/,
  'legacy compatibility sessions must never be forced through Supabase password activation',
);
assert.match(
  runtime,
  /changePersonalPassword\(this\.scope\.workspaceId, password\)/,
  'personal password changes must be bound to the authenticated workspace',
);
assert.match(app, /再次輸入新個人密碼/,
  'personal password changes must require confirmation');
assert.match(app, /兩次輸入的新密碼不一致/,
  'a mismatched personal-password confirmation must fail visibly');

console.log('normalized_legacy_login_ui=PASS');
