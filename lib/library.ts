import { createStore, del, entries, get, set, type UseStore } from 'idb-keyval';

export type LibraryItem = {
  id: string;
  title: string;
  fileName: string;
  addedAt: number;
  noteCount: number;
};

type StoredItem = LibraryItem & { file: Blob };

let store: UseStore | null = null;
const db = () => (store ??= createStore('pianolearn', 'scores'));

// Pas de crypto.randomUUID : il ne marche pas en http sur le wifi local (test sur téléphone)
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const toMeta = (v: StoredItem): LibraryItem => ({
  id: v.id,
  title: v.title,
  fileName: v.fileName,
  addedAt: v.addedAt,
  noteCount: v.noteCount,
});

export async function addToLibrary(file: File, title: string, noteCount: number): Promise<LibraryItem> {
  const item: StoredItem = { id: newId(), title, fileName: file.name, addedAt: Date.now(), noteCount, file };
  await set(item.id, item, db());
  // Demande au navigateur de ne pas effacer ces données (Chrome / Android)
  navigator.storage?.persist?.().catch(() => {});
  return toMeta(item);
}

export async function listLibrary(): Promise<LibraryItem[]> {
  const all = await entries<string, StoredItem>(db());
  return all.map(([, v]) => toMeta(v)).sort((a, b) => a.title.localeCompare(b.title, 'fr'));
}

export async function openFromLibrary(id: string): Promise<File | undefined> {
  const v = await get<StoredItem>(id, db());
  return v ? new File([v.file], v.fileName) : undefined;
}

export async function removeFromLibrary(id: string): Promise<void> {
  await del(id, db());
}
