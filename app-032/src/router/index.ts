import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue'), meta: { title: '灯型选择与新建' } },
  { path: '/design/:id', name: 'design', component: () => import('../views/DesignView.vue'), meta: { title: '参数与灯体预览' } },
  { path: '/frame/:id', name: 'frame', component: () => import('../views/FrameView.vue'), meta: { title: '骨架构件表' } },
  { path: '/panels/:id', name: 'panels', component: () => import('../views/PanelsView.vue'), meta: { title: '蒙面裁片与缝份' } },
  { path: '/print/:id', name: 'print', component: () => import('../views/PrintView.vue'), meta: { title: '1:1 放样图' } },
  { path: '/materials/:id', name: 'materials', component: () => import('../views/MaterialsView.vue'), meta: { title: '材料统计与备料单' } },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

router.afterEach((to) => {
  const t = (to.meta.title as string) || ''
  document.title = (t ? t + ' · ' : '') + '花灯骨架放样与蒙面裁片'
})
