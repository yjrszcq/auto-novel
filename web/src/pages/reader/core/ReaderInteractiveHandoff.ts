export interface ReaderSessionStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

const readerInteractiveSelectionKey = 'interactive-reader-selection';

export const storeReaderInteractiveSelection = (
  storage: ReaderSessionStorage,
  text: string,
) => {
  const selection = text.trim();
  if (selection.length === 0) {
    return false;
  }
  try {
    storage.setItem(readerInteractiveSelectionKey, selection);
    return true;
  } catch {
    return false;
  }
};

export const consumeReaderInteractiveSelection = (
  storage: ReaderSessionStorage,
) => {
  try {
    const selection = storage.getItem(readerInteractiveSelectionKey)?.trim();
    storage.removeItem(readerInteractiveSelectionKey);
    return selection || undefined;
  } catch {
    return undefined;
  }
};
