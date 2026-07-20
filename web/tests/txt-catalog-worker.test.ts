import { describe, expect, it } from 'vitest';

import type { TxtCatalogWorkerResponse } from '../src/util/file/TxtCatalogWorkerProtocol';
import { createTxtCatalogWorkerService } from '../src/util/file/TxtCatalogWorkerService';

const bufferOf = (text: string) => new TextEncoder().encode(text).buffer;

describe('TXT catalog Worker service', () => {
  it('keeps the document in the service and only returns preview metadata', () => {
    const progress: TxtCatalogWorkerResponse[] = [];
    const service = createTxtCatalogWorkerService((event) =>
      progress.push(event),
    );
    const result = service.handle({
      type: 'initialize',
      requestId: 1,
      fileName: 'book.txt',
      buffer: bufferOf('第一章 开始\n正文\n第二章 继续\n正文'),
      mode: 'balanced',
    });

    expect(result).toMatchObject({
      fileName: 'book.txt',
      mode: 'balanced',
      encoding: 'utf-8',
      lineCount: 4,
    });
    expect(result).not.toHaveProperty('text');
    expect(result).not.toHaveProperty('lines');
    expect(progress.map((event) => event.type)).toEqual([
      'progress',
      'progress',
      'progress',
      'progress',
    ]);
  });

  it('returns bounded line windows and supports wrapped search', () => {
    const lines = Array.from({ length: 700 }, (_, index) => `line ${index}`);
    lines[3] = 'needle first';
    lines[4] = 'boundary first';
    lines[699] = 'boundary last';
    const service = createTxtCatalogWorkerService();
    service.handle({
      type: 'initialize',
      requestId: 1,
      fileName: 'large.txt',
      buffer: bufferOf(lines.join('\n')),
      mode: 'balanced',
    });

    const window = service.handle({
      type: 'get-lines',
      requestId: 2,
      startLine: 100,
      count: 1_000,
    });
    expect(window).toMatchObject({ startLine: 100, totalLines: 700 });
    expect('lines' in window && window.lines).toHaveLength(500);

    const search = service.handle({
      type: 'search',
      requestId: 3,
      query: 'NEEDLE',
      startLine: 200,
      limit: 20,
    });
    expect(search).toEqual({ lineIndexes: [3], wrapped: true });

    const searchAfterLastLine = service.handle({
      type: 'search',
      requestId: 4,
      query: 'BOUNDARY',
      startLine: 700,
      limit: 1,
    });
    expect(searchAfterLastLine).toEqual({
      lineIndexes: [4],
      wrapped: true,
    });
  });

  it('reparses modes and builds a plan from reviewed headings', () => {
    const service = createTxtCatalogWorkerService();
    service.handle({
      type: 'initialize',
      requestId: 1,
      fileName: 'custom.txt',
      buffer: bufferOf('intro\nCustom title\nbody'),
      mode: 'strict',
    });
    const preview = service.handle({
      type: 'reparse',
      requestId: 2,
      mode: 'loose',
    });
    expect(preview).toMatchObject({ mode: 'loose' });

    const plan = service.handle({
      type: 'build-plan',
      requestId: 3,
      headings: [
        {
          lineIndex: 1,
          title: 'Edited title',
          level: 2,
          rule: 'manual',
          confidence: 1,
          isManual: true,
        },
      ],
    });
    expect(plan).toMatchObject({
      mode: 'loose',
      chapters: [
        { title: '正文前言', sourceStartLine: 0, sourceEndLine: 0 },
        { title: 'Edited title', sourceStartLine: 1, sourceEndLine: 2 },
      ],
    });
  });
});
