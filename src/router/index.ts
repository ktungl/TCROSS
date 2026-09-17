import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from '../views/DashboardView.vue'
import ListView from '../views/ListView.vue'
import DetailView from '../views/DetailView.vue'
import PlansView from '../views/PlansView.vue'
import PlanDetailView from '../views/PlanDetailView.vue'
import CategoriesView from '../views/CategoriesView.vue'
import ExportView from '../views/ExportView.vue'
import LoginView from '../views/LoginView.vue'
import Parse from '../lib/parse'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
    { path: '/dashboard', name: 'dashboard', component: DashboardView },
    { path: '/', name: 'list', component: ListView },
    { path: '/activities/:id', name: 'detail', component: DetailView, props: true },
    { path: '/plans', name: 'plans', component: PlansView },
    { path: '/plans/:id', name: 'plan-detail', component: PlanDetailView, props: true },
    { path: '/categories', name: 'categories', component: CategoriesView },
    { path: '/export', name: 'export', component: ExportView },
  ],
})

router.beforeEach((to) => {
  const loggedIn = !!Parse.User.current()
  if (!loggedIn && !to.meta.public) return { name: 'login' }
  if (loggedIn && to.name === 'login') return { name: 'list' }
})

export default router
