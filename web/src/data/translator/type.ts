export type Glossary = { [key: string]: string };

export type Segmentor = (input: string[]) => Promise<string[][]>;

export interface BaseTranslatorConfig {
  log: (message: string, detail?: string[]) => void;
  glossary: Glossary;
}

export interface SegmentTranslator {
  glossary: Glossary;
  createSegments: Segmentor;
  translate: (
    seg: string[],
    segInfo: { index: number; size: number }
  ) => Promise<string[]>;
  log: (message: string, detail?: string[]) => void;
}
