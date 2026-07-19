import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReaderEpubResource } from '../src/model/Reader';

import { EpubResourceSession } from '../src/pages/reader/core/EpubResources';

const resources: ReaderEpubResource[] = [
  {
    path: 'OPS/Images/cover.png',
    mediaType: 'image/png',
    blob: new Blob(['image'], { type: 'image/png' }),
  },
  {
    path: 'OPS/Styles/nested.css',
    mediaType: 'text/css',
    blob: new Blob(['.nested { background: url(../Images/cover.png) }'], {
      type: 'text/css',
    }),
  },
];

afterEach(() => vi.restoreAllMocks());

describe('EPUB resource session', () => {
  it('resolves only package-local resources and revokes each object URL', () => {
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:image');
    const revoke = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {});
    const session = new EpubResourceSession(resources);

    expect(
      session.resolveAsset('OPS/Text/chapter.xhtml', '../Images/cover.png'),
    ).toBe('blob:image');
    expect(
      session.resolveAsset('OPS/Text/chapter.xhtml', '../Images/cover.png'),
    ).toBe('blob:image');
    expect(
      session.resolveAsset(
        'OPS/Text/chapter.xhtml',
        'https://example.com/tracker.png',
      ),
    ).toBeUndefined();
    expect(session.resolveAsset('OPS/Text/chapter.xhtml', '#icon')).toBe(
      '#icon',
    );
    expect(create).toHaveBeenCalledTimes(1);

    session.dispose();
    expect(revoke).toHaveBeenCalledWith('blob:image');
  });

  it('rewrites local CSS urls/imports and blocks active or remote values', async () => {
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:nested-image')
      .mockReturnValueOnce('blob:nested-css');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const session = new EpubResourceSession(resources);

    const css = await session.rewriteCss(
      `@import "../Styles/nested.css" screen;
       .cover { background: url('../Images/cover.png') }
       .remote { background: url(https://example.com/tracker.png) }
       .active { width: expression(alert(1)); }`,
      'OPS/Text/chapter.xhtml',
    );

    expect(css).toContain('@import url("blob:nested-css") screen;');
    expect(css).toContain('url("blob:nested-image")');
    expect(css).toContain('url("about:blank")');
    expect(css).not.toContain('expression');
    session.dispose();
  });
});
