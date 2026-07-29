import { createRouter, createWebHistory } from 'vue-router'
import ListView from '../views/ListView.vue'
import DetailView from '../views/DetailView.vue'
import PlansView from '../views/PlansView.vue'
import ExportView from '../views/ExportView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'list', component: ListView },
    { path: '/activities/:id', name: 'detail', component: DetailView, props: true },
    { path: '/plans', name: 'plans', component: PlansView },
    { path: '/export', name: 'export', component: ExportView },
  ],
})

export default router
