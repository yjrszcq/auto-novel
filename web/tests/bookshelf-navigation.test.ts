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

  it('keeps the bookshelf and workspace sections highlighted', () => {
    expect(getMainMenuKey('/bookshelf')).toBe('/bookshelf');
    expect(getMainMenuKey('/workspace/gpt/jobs')).toBe('/workspace/gpt');
    expect(getMainMenuKey('/')).toBe('/');
  });
});
