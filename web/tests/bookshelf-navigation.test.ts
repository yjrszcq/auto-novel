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
  it('uses the home route as the only bookshelf page', () => {
    expect(getPaths(applicationRoutes)).toContain('/');
    expect(getPaths(applicationRoutes)).not.toContain('/bookshelf');
  });

  it('registers only the current reader route', () => {
    expect(getPaths(applicationRoutes)).toContain(
      '/books/:bookId/read/:chapterId?',
    );
    expect(getPaths(applicationRoutes)).not.toContain(
      '/workspace/reader/:novelId/:chapterId',
    );
  });

  it('keeps the home and workspace sections highlighted', () => {
    expect(getMainMenuKey('/workspace/gpt/jobs')).toBe('/workspace/gpt');
    expect(getMainMenuKey('/')).toBe('/');
  });
});
