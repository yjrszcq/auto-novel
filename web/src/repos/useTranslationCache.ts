import { lazy } from '@/util';
import type { DBSchema } from 'idb';
import { openDB } from 'idb';

export type TranslationCacheType = 'gpt-seg-cache' | 'sakura-seg-cache';

type CacheEntry = {
  hash: string;
  text: string[];
  createdAt: number;
  lastUsedAt: number;
  size: number;
};

type CacheMetadata = {
  type: TranslationCacheType;
  entryCount: number;
  totalSize: number;
};

interface TranslationCacheDBSchema extends DBSchema {
  'gpt-seg-cache': {
    key: string;
    value: CacheEntry;
    indexes: { 'by-last-used': [number, string] };
  };
  'sakura-seg-cache': {
    key: string;
    value: CacheEntry;
    indexes: { 'by-last-used': [number, string] };
  };
  'cache-meta': {
    key: TranslationCacheType;
    value: CacheMetadata;
  };
}

export type TranslationCacheLimits = {
  maximumEntries: number;
  maximumSize: number;
};

const defaultLimits: TranslationCacheLimits = {
  maximumEntries: 5_000,
  maximumSize: 50 * 1024 * 1024,
};

const generations: Record<TranslationCacheType, number> = {
  'gpt-seg-cache': 0,
  'sakura-seg-cache': 0,
};

const createDb = lazy(() => {
  return openDB<TranslationCacheDBSchema>('auto-novel-translation-cache', 2, {
    upgrade(db) {
      for (const storeName of [
        'gpt-seg-cache',
        'sakura-seg-cache',
        'cache-meta',
      ] as const) {
        if (db.objectStoreNames.contains(storeName)) {
          db.deleteObjectStore(storeName);
        }
      }
      for (const storeName of ['gpt-seg-cache', 'sakura-seg-cache'] as const) {
        const store = db.createObjectStore(storeName, { keyPath: 'hash' });
        store.createIndex('by-last-used', ['lastUsedAt', 'hash']);
      }
      db.createObjectStore('cache-meta', { keyPath: 'type' });
    },
  });
});

const emptyMetadata = (type: TranslationCacheType): CacheMetadata => ({
  type,
  entryCount: 0,
  totalSize: 0,
});

const estimateSize = (hash: string, text: string[]) =>
  (hash.length + text.reduce((size, line) => size + line.length, 0)) * 2;

export const TranslationCacheRepo = {
  async clear(type: TranslationCacheType) {
    generations[type] += 1;
    const db = await createDb();
    const tx = db.transaction([type, 'cache-meta'], 'readwrite');
    await Promise.all([
      tx.objectStore(type).clear(),
      tx.objectStore('cache-meta').put(emptyMetadata(type)),
      tx.done,
    ]);
  },

  async get(type: TranslationCacheType, hash: string, now = Date.now()) {
    const db = await createDb();
    const tx = db.transaction(type, 'readwrite');
    const store = tx.objectStore(type);
    const entry = await store.get(hash);
    if (entry !== undefined) {
      entry.lastUsedAt = now;
      await store.put(entry);
    }
    await tx.done;
    return entry?.text;
  },

  async create(
    type: TranslationCacheType,
    hash: string,
    text: string[],
    options?: { now?: number; limits?: Partial<TranslationCacheLimits> },
  ) {
    const now = options?.now ?? Date.now();
    const limits = { ...defaultLimits, ...options?.limits };
    const db = await createDb();
    const tx = db.transaction([type, 'cache-meta'], 'readwrite');
    const store = tx.objectStore(type);
    const metadataStore = tx.objectStore('cache-meta');
    const previous = await store.get(hash);
    const entry: CacheEntry = {
      hash,
      text,
      createdAt: previous?.createdAt ?? now,
      lastUsedAt: now,
      size: estimateSize(hash, text),
    };
    const metadata = (await metadataStore.get(type)) ?? emptyMetadata(type);
    metadata.entryCount += previous === undefined ? 1 : 0;
    metadata.totalSize += entry.size - (previous?.size ?? 0);
    await store.put(entry);

    const oldest = store.index('by-last-used');
    while (
      metadata.entryCount > Math.max(0, limits.maximumEntries) ||
      metadata.totalSize > Math.max(0, limits.maximumSize)
    ) {
      const cursor = await oldest.openCursor();
      if (cursor === null) break;
      metadata.entryCount -= 1;
      metadata.totalSize -= cursor.value.size;
      await cursor.delete();
    }
    await metadataStore.put(metadata);
    await tx.done;
  },

  async metrics(type: TranslationCacheType) {
    const db = await createDb();
    return (await db.get('cache-meta', type)) ?? emptyMetadata(type);
  },

  generation(type: TranslationCacheType) {
    return generations[type];
  },
};
