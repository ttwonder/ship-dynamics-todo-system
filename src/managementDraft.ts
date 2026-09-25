import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

// Component-only drafts: typing AND clearing advance synchronously; initialization does not.
export type ManagementDraftReporter = (token: object, dirty: boolean) => void;
export const confirmManagementDraftDiscard = () => window.confirm('尚有未提交的管理表單修改。確定放棄這些修改並繼續？');

// Apply only the fields edited against the original private baseline. The
// transaction still owns record CAS; divergent edits to the same field reject.
export function mergeManagementDraft<T>(baseline: T, draft: T, latest: T): T {
  const result = { ...latest };
  for (const key in draft) {
    if (JSON.stringify(draft[key]) === JSON.stringify(baseline[key])) continue;
    if (JSON.stringify(latest[key]) !== JSON.stringify(baseline[key]) && JSON.stringify(latest[key]) !== JSON.stringify(draft[key])) throw new Error('管理表單欄位已由其他人更新，原草稿已保留，請核對後重新編輯');
    result[key] = draft[key];
  }
  return result;
}

export function useManagementDraft<T>(initial: () => T, report?: ManagementDraftReporter) {
  const [value, setValue] = useState(initial);
  const baseline = useRef(value);
  const state = useRef({ version: 0, epoch: 0, dirty: false, mounted: true });
  const token = useRef({}), reporter = useRef(report);
  reporter.current = report;
  const publish = (dirty: boolean) => reporter.current?.(token.current, dirty);
  useEffect(() => { state.current.mounted = true; return () => { state.current.mounted = false; state.current.epoch++; publish(false); }; }, []);
  const edit: Dispatch<SetStateAction<T>> = next => { state.current.version++; state.current.dirty = true; publish(true); setValue(next); };
  const initialize = (next: T) => { state.current.epoch++; state.current.dirty = false; baseline.current = next; publish(false); setValue(next); };
  const refresh = (next: T) => { if (!state.current.dirty) { baseline.current = next; setValue(next); } };
  const capture = () => {
    const { epoch, version } = state.current;
    const base = baseline.current;
    const sameEditor = () => state.current.mounted && state.current.epoch === epoch;
    const unchanged = () => sameEditor() && state.current.version === version;
    return { sameEditor, unchanged, merge: (latest: T) => mergeManagementDraft(base, value, latest), clean: () => { if (unchanged()) { baseline.current = value; state.current.dirty = false; publish(false); } } };
  };
  return { value, edit, initialize, refresh, capture, isDirty: () => state.current.dirty };
}
