import { createApp } from 'vue'
import App from './App.vue'
import './index.css'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import { IconInstaller } from './utils'
import log from 'electron-log/renderer';
console.log = log.log;
Object.assign(console, log.functions);

const app = createApp(App)
app.use(ElementPlus)
IconInstaller(app)
app.mount('#app')
