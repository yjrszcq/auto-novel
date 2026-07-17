import { lazy } from '@/util';
import type { DBSchema } from 'idb';
import { openDB } from 'idb';

interface TranslationCacheDBSchema extends DBSchema {
  'gpt-seg-cache': {
    key: string;
    value: { hash: string; text: string[] };
  };
  'sakura-seg-cache': {
    key: string;
    value: { hash: string; text: string[] };
  };
}

type TranslationCacheType = 'gpt-seg-cache' | 'sakura-seg-cache';

const createDb = lazy(() => {
  return openDB<TranslationCacheDBSchema>('auto-novel-translation-cache', 1, {
    upgrade(db) {
      db.createObjectStore('gpt-seg-cache', { keyPath: 'hash' });
      db.createObjectStore('sakura-seg-cache', { keyPath: 'hash' });
    },
  });
});

export const TranslationCacheRepo = {
  clear: (type: TranslationCacheType) =>
    createDb().then((db) => db.clear(type)),
  get: (type: TranslationCacheType, hash: string) =>
    createDb().then((db) => db.get(type, hash).then((it) => it?.text)),
  create: (type: TranslationCacheType, hash: string, text: string[]) =>
    createDb().then((db) => db.put(type, { hash, text })),
};
