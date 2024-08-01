import log from 'electron-log/main';
import {app} from "electron";

var fs = require("fs")
const path = require("path")

Date.prototype.Format = function (fmt) {
    var o = {
        "M+": this.getMonth() + 1, //月份
        "d+": this.getDate(), //日
        "h+": this.getHours(), //小时
        "m+": this.getMinutes(), //分
        "s+": this.getSeconds(), //秒
        "q+": Math.floor((this.getMonth() + 3) / 3), //季度
        "S": this.getMilliseconds() //毫秒
    };
    if (/(y+)/.test(fmt)) fmt = fmt.replace(RegExp.$1, (this.getFullYear() + "").substr(4 - RegExp.$1.length));
    for (var k in o)
        if (new RegExp("(" + k + ")").test(fmt)) fmt = fmt.replace(RegExp.$1, (RegExp.$1.length == 1) ? (o[k]) : (("00" + o[k]).substr(("" + o[k]).length)));
    return fmt;
}


const isDev = !app.isPackaged
const appRoot = isDev ? path.resolve(__dirname, '..', '..') : path.resolve(app.getAppPath(), '..', '..')
const userDataPath = path.resolve(appRoot, 'userData')
const cwd = path.resolve(userDataPath, './logs/')
//创建目录
fs.existsSync(cwd) || fs.mkdirSync(cwd, {recursive: true})

log.initialize();
log.transports.file.level = 'debug'
log.transports.file.maxSize = 1002430 // 10M
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]{scope} {text}'
let date = (new Date()).Format("yyyy-MM-dd hh mm ss")
log.transports.file.resolvePathFn = (variables) => {
    return path.join(cwd, date + '.log');
}
console.log = log.log
Object.assign(console, log.functions);

console.log('log initialized [' + path.join(cwd, date + '.log') + "]")
export default log
