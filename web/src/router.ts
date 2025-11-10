import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/*',
      meta: { isReader: true },
      component: () => import('./pages/reader/ReaderLayout.vue'),
      children: [
        {
          path: '/workspace/reader/:novelId/:chapterId',
          components: {
            reader: () => import('./pages/reader/Reader.vue'),
          },
        },
      ],
    },
    {
      path: '/*',
      component: () => import('./pages/MainLayout.vue'),
      children: [
        {
          path: '/',
          meta: { title: '首页' },
          component: () => import('./pages/home/Home.vue'),
        },
        {
          path: '/workspace',
          redirect: '/workspace/gpt',
          children: [
            {
              path: 'toolbox',
              meta: { title: '小说工具箱' },
              component: () => import('./pages/workspace/Toolbox.vue'),
            },
            {
              path: 'gpt',
              meta: { title: 'GPT工作区' },
              component: () => import('./pages/workspace/GptWorkspace.vue'),
            },
            {
              path: 'sakura',
              meta: { title: 'Sakura工作区' },
              component: () => import('./pages/workspace/SakuraWorkspace.vue'),
            },
            {
              path: 'interactive',
              meta: { title: '交互翻译' },
              component: () => import('./pages/workspace/Interactive.vue'),
            },
          ],
        },
        {
          path: '/setting',
          meta: { title: '设置' },
          component: () => import('./pages/other/Setting.vue'),
        },
        {
          path: '/:pathMatch(.*)*',
          component: () => import('./pages/other/NotFound.vue'),
        },
      ],
    },
  ],
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
