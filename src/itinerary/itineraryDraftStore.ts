import type { ItineraryDocument } from './itineraryTypes';
import type { BrowserAuthority } from '../cloudSourceAuthority';

const DATABASE_NAME = 'ship-dynamics-itinerary-drafts-v1';
const STORE_NAME = 'drafts';
const FALLBACK_PREFIX = 'ship-dynamics-itinerary/draft-fallback/';

export interface ItineraryDraftRecord {
  key: string;
  workspaceKey: string;
  vesselId: string;
  actorId: string;
  baseRevision: number;
  savedAt: string;
  document: ItineraryDocument;
  pendingOperation?: ItineraryPendingOperation;
}

export interface ItineraryPendingOperation {
  sourceAuthority?: BrowserAuthority;
  id: string;
  signature: string;
}

export function itineraryDraftKey(workspaceKey: string, vesselId: string, actorId: string): string {
  return [workspaceKey, vesselId, actorId].map(encodeURIComponent).join('/');
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('indexeddb-unavailable'));
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onerror = () => reject(request.error || new Error('indexeddb-open-failed'));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function databaseTransaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => { database.close(); reject(transaction.error || new Error('indexeddb-transaction-failed')); };
    transaction.onabort = () => { database.close(); reject(transaction.error || new Error('indexeddb-transaction-aborted')); };
    operation(store, resolve, reject);
  });
}

function fallbackKey(key: string): string {
  return `${FALLBACK_PREFIX}${key}`;
}

export async function saveItineraryDraft(record: ItineraryDraftRecord): Promise<void> {
  try {
    await databaseTransaction<void>('readwrite', (store, resolve, reject) => {
      const request = store.put(structuredClone(record));
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    try { localStorage.setItem(fallbackKey(record.key), JSON.stringify(record)); } catch { /* draft remains in component memory */ }
  }
}

export async function readItineraryDraft(key: string): Promise<ItineraryDraftRecord | null> {
  try {
    const record = await databaseTransaction<ItineraryDraftRecord | null>('readonly', (store, resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve((request.result as ItineraryDraftRecord | undefined) || null);
      request.onerror = () => reject(request.error);
    });
    if (record) return record;
  } catch { /* use fallback below */ }
  try {
    const raw = localStorage.getItem(fallbackKey(key));
    return raw ? JSON.parse(raw) as ItineraryDraftRecord : null;
  } catch {
    return null;
  }
}

export async function deleteItineraryDraft(key: string): Promise<void> {
  try {
    await databaseTransaction<void>('readwrite', (store, resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch { /* still remove fallback */ }
  try { localStorage.removeItem(fallbackKey(key)); } catch { /* no-op */ }
}

// Only delete the exact IndexedDB record that was reconciled. A fallback
// record is retained: the two stores cannot provide one atomic compare/delete.
export async function deleteItineraryDraftIfUnchanged(expected: ItineraryDraftRecord, isCurrent: () => boolean): Promise<boolean> {
  const fallbackAbsent = () => {
    try { return localStorage.getItem(fallbackKey(expected.key)) === null; } catch { return false; }
  };
  if (!isCurrent() || !fallbackAbsent()) return false;
  let database: IDBDatabase;
  try { database = await openDatabase(); } catch { return false; }
  if (!isCurrent()) { database.close(); return false; }
  return new Promise<boolean>(resolve => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    let deleted = false;
    transaction.oncomplete = () => { database.close(); resolve(deleted && isCurrent() && fallbackAbsent()); };
    transaction.onerror = transaction.onabort = () => { database.close(); resolve(false); };
    const read = store.get(expected.key);
    read.onsuccess = () => {
      if (!isCurrent() || !fallbackAbsent() || JSON.stringify(read.result) !== JSON.stringify(expected)) return;
      const removal = store.delete(expected.key);
      removal.onsuccess = () => { deleted = true; };
    };
  });
}

export const ITINERARY_DRAFT_STORAGE_PREFIX = FALLBACK_PREFIX;
