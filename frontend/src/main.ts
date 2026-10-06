import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { initGovernance } from './api/governance-service'
import { emitDataChanged } from './api/events'
import { setChangeHook } from './data/local-store'
import './styles/global.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

// 存储层每次落账广播一次，概览、排班、看板收到后一起重算。
setChangeHook(emitDataChanged)
// 启动时把巡检发现的问题幂等补齐到隐患整改台账（只补挂、不改既有结论）。
initGovernance()
