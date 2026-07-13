import type { RouteRecordRaw } from 'vue-router';
import { describe, expect, it } from 'vitest';

import { getMainMenuKey } from '../src/pages/navigation';
import { applicationRoutes } from '../src/router/routes';

const getPaths = (routes: readonly RouteRecordRaw[]): string[] =>
  routes.flatMap((route) => [
    route.path,
    ...(route.children === undefined ? [] : getPaths(route.children)),
  ]);

describe('bookshelf navigation', () => {
  it('registers the bookshelf route', () => {
    expect(getPaths(applicationRoutes)).toContain('/bookshelf');
  });

  it('redirects legacy reader links to the book reader route', () => {
    const legacyReaderRoute = applicationRoutes[0].children?.find(
      (route) => route.path === '/workspace/reader/:novelId/:chapterId',
    );
    const redirect = legacyReaderRoute?.redirect;

    expect(redirect).toBeTypeOf('function');
    expect(
      (redirect as (to: { params: Record<string, string> }) => string)({
        params: { novelId: 'book name.epub', chapterId: 'first' },
      }),
    ).toBe('/books/book%20name.epub/read/first');
    expect(getPaths(applicationRoutes)).toContain(
      '/books/:bookId/read/:chapterId?',
    );
  });

  it('keeps the bookshelf and workspace sections highlighted', () => {
    expect(getMainMenuKey('/bookshelf')).toBe('/bookshelf');
    expect(getMainMenuKey('/workspace/gpt/jobs')).toBe('/workspace/gpt');
    expect(getMainMenuKey('/')).toBe('/');
  });
});
