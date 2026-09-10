import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

// Component-only drafts: typing AND clearing advance synchronously; initialization does not.
export function useManagementDraft<T>(initial: () => T) {
  const [value, setValue] = useState(initial);
  const state = useRef({ version: 0, epoch: 0, dirty: false, mounted: true });
  useEffect(() => { state.current.mounted = true; return () => { state.current.mounted = false; state.current.epoch++; }; }, []);
  const edit: Dispatch<SetStateAction<T>> = next => { state.current.version++; state.current.dirty = true; setValue(next); };
  const initialize = (next: T) => { state.current.epoch++; state.current.dirty = false; setValue(next); };
  const refresh = (next: T) => { if (!state.current.dirty) setValue(next); };
  const capture = () => {
    const { epoch, version } = state.current;
    const sameEditor = () => state.current.mounted && state.current.epoch === epoch;
    const unchanged = () => sameEditor() && state.current.version === version;
    return { sameEditor, unchanged, clean: () => { if (unchanged()) state.current.dirty = false; } };
  };
  return { value, edit, initialize, refresh, capture };
}
