import 'fake-indexeddb/auto';

import { deleteDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';

import { createReviewedTxtVolume } from '../src/stores/local/CreateVolume';
import { createLocalVolumeDao } from '../src/stores/local/LocalVolumeDao';
import { parseTxtCatalog } from '../src/util/file/TxtCatalogParser';
import { decodeTxtText } from '../src/util/file/TxtDecode';

const databaseName = 'create-volume-atomic-test';

afterEach(async () => {
  await deleteDB(databaseName);
});

describe('local volume creation transaction', () => {
  it('commits exactly one complete graph for concurrent duplicate imports', async () => {
    const dao = await createLocalVolumeDao(databaseName);
    const first = new File(['first line\nsecond line'], 'same-book.txt', {
      type: 'text/plain',
    });
    const second = new File(['replacement'], 'same-book.txt', {
      type: 'text/plain',
    });
    const firstPlan = parseTxtCatalog(decodeTxtText('first line\nsecond line'));
    const secondPlan = parseTxtCatalog(decodeTxtText('replacement'));

    const results = await Promise.allSettled([
      createReviewedTxtVolume(dao, first, 'default', firstPlan),
      createReviewedTxtVolume(dao, second, 'default', secondPlan),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejection = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(String(rejection?.reason)).toContain('小说已经存在');
    expect(await dao.listMetadata()).toHaveLength(1);
    expect(await dao.listChapterByVolumeId('same-book.txt')).toHaveLength(1);
    expect(await dao.getFile('same-book.txt')).toBeDefined();
    dao.close();
  });
});
