import type { RouteRecordRaw } from 'vue-router';

export const applicationRoutes: RouteRecordRaw[] = [
  {
    path: '/*',
    meta: { isReader: true },
    component: () => import('../pages/reader/ReaderLayout.vue'),
    children: [
      {
        path: '/workspace/reader/:novelId/:chapterId',
        redirect: (to) =>
          `/books/${encodeURIComponent(String(to.params.novelId))}/read/${encodeURIComponent(String(to.params.chapterId))}`,
      },
      {
        path: '/books/:bookId/read/:chapterId?',
        components: {
          reader: () => import('../pages/reader/BookReader.vue'),
        },
      },
    ],
  },
  {
    path: '/*',
    component: () => import('../pages/MainLayout.vue'),
    children: [
      {
        path: '/',
        meta: { title: '首页' },
        component: () => import('../pages/home/Home.vue'),
      },
      {
        path: '/workspace',
        redirect: '/workspace/gpt',
        children: [
          {
            path: 'toolbox',
            meta: { title: '小说工具箱' },
            component: () => import('../pages/workspace/Toolbox.vue'),
          },
          {
            path: 'gpt',
            meta: { title: 'GPT工作区' },
            component: () => import('../pages/workspace/GptWorkspace.vue'),
          },
          {
            path: 'sakura',
            meta: { title: 'Sakura工作区' },
            component: () => import('../pages/workspace/SakuraWorkspace.vue'),
          },
          {
            path: 'interactive',
            meta: { title: '交互翻译' },
            component: () => import('../pages/workspace/Interactive.vue'),
          },
        ],
      },
      {
        path: '/bookshelf',
        meta: { title: '书架' },
        component: () => import('../pages/bookshelf/Bookshelf.vue'),
      },
      {
        path: '/books/:bookId/details',
        meta: { title: '书籍详情' },
        component: () => import('../pages/bookshelf/BookDetails.vue'),
      },
      {
        path: '/books/:bookId/edit',
        meta: { title: '编辑书籍展示信息' },
        component: () => import('../pages/bookshelf/BookMetadataEdit.vue'),
      },
      {
        path: '/setting',
        meta: { title: '设置' },
        component: () => import('../pages/other/Setting.vue'),
      },
      {
        path: '/:pathMatch(.*)*',
        component: () => import('../pages/other/NotFound.vue'),
      },
    ],
  },
];
