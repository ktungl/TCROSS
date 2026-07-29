import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from '../views/DashboardView.vue'
import ListView from '../views/ListView.vue'
import DetailView from '../views/DetailView.vue'
import PlansView from '../views/PlansView.vue'
import PlanDetailView from '../views/PlanDetailView.vue'
import ExportView from '../views/ExportView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/dashboard', name: 'dashboard', component: DashboardView },
    { path: '/', name: 'list', component: ListView },
    { path: '/activities/:id', name: 'detail', component: DetailView, props: true },
    { path: '/plans', name: 'plans', component: PlansView },
    { path: '/plans/:id', name: 'plan-detail', component: PlanDetailView, props: true },
    { path: '/export', name: 'export', component: ExportView },
  ],
})

export default router
