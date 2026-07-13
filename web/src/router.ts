import { createRouter, createWebHistory } from 'vue-router';

import { applicationRoutes } from './router/routes';

const router = createRouter({
  history: createWebHistory(),
  routes: applicationRoutes,
  scrollBehavior(to, from, savedPosition) {
    if (to.meta.isReader && from.meta.isReader) return;

    if (to.hash) {
      const decodedHash = encodeURIComponent(to.hash.substring(1));
      const element = document.getElementById(decodedHash);
      if (element) {
        const top = element.getBoundingClientRect().top + window.scrollY - 58;
        setTimeout(() => window.scrollTo({ top }));
        return { top };
      }
    }
    return { top: savedPosition?.top ?? 0 };
  },
});

router.afterEach((to, from) => {
  if (!(to.meta.isReader && from.meta.isReader)) {
    const titleParts = [] as string[];
    if (to.meta.title) {
      titleParts.push(to.meta.title as string);
    }
    titleParts.push('轻小说机翻机器人');
    document.title = titleParts.join(' | ');
  }
});

export default router;
