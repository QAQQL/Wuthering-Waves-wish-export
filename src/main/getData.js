const fs = require('fs-extra')
const path = require('path')
const {URL} = require('url')
const {app, ipcMain, shell, clipboard, dialog} = require('electron')
const {hash, readdir, sleep, request, sendMsg, readJSON, saveJSON, userDataPath, userPath, localIp, langMap, getCacheText, existsFile} = require('./utils')
const config = require('./config')
const getItemTypeNameMap = require('./gachaTypeMap').getItemTypeNameMap
const i18n = require('./i18n')
const {enableProxy, disableProxy} = require('./module/system-proxy')
const mitmproxy = require('./module/node-mitmproxy')

const dataMap = new Map()
let apiDomain = 'https://gmserver-api.aki-game2.com'
let logPath = '/Client/Saved/Logs/Client.log'

const saveData = async (data, url) => {
    const obj = Object.assign({}, data)
    obj.result = [...obj.result]
    obj.typeMap = [...obj.typeMap]
    if (url) {
        config.urls.set(data.uid, url)
        await config.save()
    }
    await saveJSON(`gacha-list-${data.uid}.json`, obj)
}

const defaultTypeMap = new Map([["7", "新手自选唤取(感恩定向唤取)"], ['6', '新手自选唤取'], ['5', '新手唤取'], ['4', '武器常驻唤取'], ['3', '角色常驻唤取'], ['2', '武器活动唤取'], ['1', '角色活动唤取']])

let localDataReaded = false
/**
 * 读取本地数据
 * @param force 是否强制读取
 * @returns {Promise<void>}
 */
const readData = async (force = false) => {
    if (localDataReaded && !force) return
    localDataReaded = true
    await fs.ensureDir(userDataPath)
    const files = await readdir(userDataPath)

    dataMap.clear()
    for (let name of files) {
        if (/^gacha-list-\d+\.json$/.test(name)) {
            try {
                const data = await readJSON(name)
                data.typeMap = new Map(data.typeMap) || defaultTypeMap
                data.result = new Map(data.result)
                if (data.uid) {
                    dataMap.set(data.uid, data)
                }
            } catch (e) {
                sendMsg(e, 'ERROR')
            }
        }
    }
    if ((!config.current && dataMap.size) || (config.current && dataMap.size && !dataMap.has(config.current))) {
        await changeCurrent(dataMap.keys().next().value)
    }
}

/**
 * 切换当前uid
 * @param uid -1失败 0新增
 * @returns {Promise<void>}
 */
const changeCurrent = async (uid) => {
    config.current = uid
    if (uid !== -1) {
        await config.save()
    }
}

const compareList = (b, a) => {
    if (!b.length) return false
    if (b.length < a.length) {
        a = a.slice(0, b.length)
    }
    const strA = a.map(item => item.slice(0, 4).join('-')).join(',')
    const strB = b.map(item => item.slice(0, 4).join('-')).join(',')
    return strA === strB
}

/**
 * 合并新老数据
 */
const mergeList = (a, b) => {
    if (!a || !a.length) return b || []
    if (!b || !b.length) return a
    const minA = new Date(a[0][0]).getTime()
    const idA = a[0][5]
    let pos = b.length
    let idFounded = false
    for (let i = b.length - 1; i >= 0; i--) {
        let idB = b[i][5]
        if (idB && idB === idA) {
            pos = i
            idFounded = true
            break
        }
    }
    if (!idFounded) {
        let width = Math.min(11, a.length, b.length)
        for (let i = 0; i < b.length; i++) {
            const time = new Date(b[i][0]).getTime()
            if (time >= minA) {
                if (compareList(b.slice(i, width + i), a.slice(0, width))) {
                    pos = i
                    break
                }
            }
        }
    }
    return b.slice(0, pos).concat(a)
}

const mergeData = (local, origin) => {
    if (local && local.result) {
        const localResult = local.result
        const localUid = local.uid
        const originUid = origin.uid
        // 数据不是当前账号,直接显示
        if (localUid !== originUid) return origin.result
        const originResult = new Map()

        // 遍历抽卡数据  { '1':[], '2':[] }
        for (let [key, value] of origin.result) {
            // 和原始数据比较
            const newVal = mergeList(value, localResult.get(key))
            // 保存合并后的数据
            originResult.set(key, newVal)
        }
        return originResult
    }
    return origin.result
}

const selectCacheFolder = async () => {
    const text = i18n.log
    const result = await dialog.showOpenDialog({
        title: '选择游戏安装目录 [ Wuthering Waves Game]', filters: [{name: '游戏本体 Game 文件夹', extensions: ['*']}], properties: ['openDirectory']
    })
    if (!result.canceled && result.filePaths.length > 0) {
        config["cacheFolder"] = result.filePaths[0]
        config.save()
        return config["cacheFolder"]
    }
    throw new Error(text.file.notFound)
}

/**
 * 获取游戏路径
 * @returns {Promise<string>}
 */
const detectGamePath = async () => {
    const text = i18n.log
    if (!!config["cacheFolder"]) {
        return config["cacheFolder"]
    }
    await selectCacheFolder()
    //注册表读取失败,权限问题,改为用户手动选择
    if (!config["cacheFolder"]) {
        throw new Error(text.file.notFound)
    }
    return config["cacheFolder"]
}

/**
 * 读取日志文件,获得抽卡记录url
 * @returns {Promise<string|boolean>}
 */
const readLog = async () => {
    const text = i18n.log
    if (!await detectGamePath() || !fs.existsSync(`${config["cacheFolder"]}/${logPath}`)) {
        throw new Error(text.file.notFound)
    }
    const logText = await fs.readFile(`${config["cacheFolder"]}/${logPath}`, 'utf8')
    //从后往前找,找到第一个url
    const urlMch = logText.match(/https.+?aki\/gacha\/index.html#\/record\?.+?record_id=.+?resources_id=\w+/g)
    if (!urlMch) {
        throw new Error(text.url.notFound)
    }
    return urlMch[urlMch.length - 1]
}

/**
 * 获取抽卡记录(带重试)
 * @param key
 * @param name
 * @param url
 * @param searchParams
 * @param retryCount
 * @returns {Promise<*|undefined>}
 */
const getGachaLog = async ({key, name, url, searchParams, retryCount}) => {
    const text = i18n.log
    try {
        const res = await request(url, searchParams)
        return res.data
    } catch (e) {
        if (retryCount) {
            sendMsg(i18n.parse(text.fetch.retry, {name, page: "全部", count: 6 - retryCount}))
            await sleep(5)
            retryCount--
            return await getGachaLog({key, name, url, searchParams, retryCount})
        } else {
            sendMsg(i18n.parse(text.fetch.retryFailed, {name, page: "全部"}))
            throw e
        }
    }
}

/**
 * 获取抽卡记录(全查,没有分页)
 * @param key
 * @param name
 * @param searchParams
 * @returns {Promise<[]>}
 */
const getGachaLogs = async ([key, name], searchParams) => {
    const text = i18n.log
    let list = []
    const url = `${apiDomain}/gacha/record/query`
    searchParams['cardPoolType'] = parseInt(key)
    //throw new Error(JSON.stringify(searchParams))
    sendMsg(i18n.parse(text.fetch.current, {name, page: "全部"}))
    let res = await getGachaLog({key, name, url, searchParams, retryCount: 5})
    await sleep(1)
    list.push(...res)
    return list
}

/**
 * 获取url中的参数,转post请求参数
 * @param url
 * @returns {Map<any, any>|boolean}
 */
const getSearchParams = (url) => {
    const text = i18n.log
    let {searchParams, host, hash} = new URL(url)
    if (host.includes('aki-gm-resources.aki-game.com')) {
    //国服
        apiDomain = 'https://gmserver-api.aki-game2.com'
    } else {
    //https://aki-gm-resources-oversea.aki-game.net
    //外服
    apiDomain = 'https://gmserver-api.aki-game2.net'
    }
    if (searchParams.toString() === '') {
        searchParams = new URLSearchParams(hash.slice(hash.indexOf('?') + 1));
    }
    const serverId = searchParams.get('svr_id')
    const playerId = searchParams.get('player_id')
    const languageCode = searchParams.get('lang')
    const recordId = searchParams.get('record_id')
    const cardPoolId = searchParams.get('resources_id')
    if (!playerId || !serverId || !languageCode || !recordId || !cardPoolId) {
        sendMsg(text.url.lackAuth)
        return false
    }
    return {
        serverId, playerId, languageCode, recordId, cardPoolId, cardPoolType: 1
    }
}

const proxyServer = (port) => {
    return new Promise((rev) => {
        mitmproxy.createProxy({
            sslConnectInterceptor: (req, cltSocket, head) => {
                if (/aki-gm-resources.*/.test(req.url)) {
                    return true
                }
            }, requestInterceptor: (rOptions, req, res, ssl, next) => {
                next()
                console.error(rOptions.protocol, rOptions.hostname, rOptions.path)
                if (/aki-gm-resources.*/.test(rOptions.hostname)) {
                    if (/#\/record\?svr_id.*/.test(rOptions.path)) {
                        rev(`${rOptions.protocol}//${rOptions.hostname}${rOptions.path}`)
                    }
                }
            }, responseInterceptor: (req, res, proxyReq, proxyRes, ssl, next) => {
                next()
            }, getPath: () => path.join(userPath, 'node-mitmproxy'), port
        })
    })
}

let proxyServerPromise
const useProxy = async () => {
    const text = i18n.log
    const ip = localIp()
    const port = config.proxyPort
    sendMsg(i18n.parse(text.proxy.hint, {ip, port}))
    await enableProxy('127.0.0.1', port)
    if (!proxyServerPromise) {
        proxyServerPromise = proxyServer(port)
    }
    const url = await proxyServerPromise
    await disableProxy()
    return url
}

const getUrl = async () => {
    return await readLog()
}

/**
 * 更新数据
 */
const fetchData = async (urlOverride) => {
    try {
        const text = i18n.log
        await readData()
        let url = urlOverride
        if (!url) {
            url = await getUrl()
        }
        if (!url) {
            throw new Error(text.url.notFound2)
        }
        let searchParams = getSearchParams(url)
        if (!searchParams) {
            throw new Error(text.url.incorrect)
        }
        const lang = searchParams['languageCode']
        const result = new Map()
        const typeMap = new Map()
        const gachaType = getItemTypeNameMap(lang)
        let originUid = searchParams['playerId']
        for (const type of gachaType) {
            const list = await getGachaLogs(type, searchParams)
            const logs = list.map((item) => {
                // resourceId是资源id,鸣潮没有记录id,使用 hash(name+cardPoolType+time)
                // todo 等待鸣潮是否有id出现,这个方案由于抽卡时间没精确到毫秒,可能会有重复
                return [item.time, item.name, item.resourceType, parseInt(item.qualityLevel), parseInt(searchParams.cardPoolType), hash(item.name + item.cardPoolType + item.time)]
            })
            logs.reverse()
            typeMap.set(type[0], type[1])
            result.set(type[0], logs)
        }
        const data = {result, time: Date.now(), typeMap, uid: originUid, lang}
        // 由于鸣潮没有记录id,现在的方案可能会重复,暂时放弃数据合并
        // const localData = dataMap.get(originUid)
        // const mergedResult = mergeData(localData, data)
        // data.result = mergedResult
        dataMap.set(originUid, data)
        await changeCurrent(originUid)
        await saveData(data, url)
    } catch (e) {
        sendMsg(e)
        await changeCurrent(-1)
        return false
    }
}

let proxyStarted = false
const fetchDataByProxy = async () => {
    if (proxyStarted) return
    proxyStarted = true
    const url = await useProxy()
    await fetchData(url)
}

ipcMain.handle('FETCH_DATA', async (event, param) => {
    try {
        if (param === 'proxy') {
            await fetchDataByProxy()
        } else {
            await fetchData(param)
        }
        return {
            dataMap, current: config.current
        }
    } catch (e) {
        sendMsg(e, 'ERROR')
        console.error(e)
    }
    return false
})

ipcMain.handle('CLEAN_LOCAL_DB', async (event, param) => {
    try {
        if (param) {
            //清空全部
            fs.readdirSync(userDataPath)
                .filter(file => file.startsWith("gacha-list-") && path.extname(file) === '.json')
                .forEach(file => {
                    fs.unlinkSync(path.join(userDataPath, file))
                })
            dataMap.clear()
            return "全部清空成功"
        } else {
            let uid = config.current
            if (existsFile(`gacha-list-${uid}.json`)) {
                fs.unlinkSync(path.join(userDataPath, `gacha-list-${uid}.json`))
                dataMap.delete(uid)
                return `清空 ${uid} 成功`
            }
        }
        return "清空失败，文件不存在"
    } catch (e) {
        sendMsg(e, 'ERROR')
        console.error(e)
        return "清空失败"
    }
})

ipcMain.handle('READ_DATA', async () => {
    await readData()
    return {
        dataMap, current: config.current
    }
})

ipcMain.handle('FORCE_READ_DATA', async () => {
    await readData(true)
    return {
        dataMap, current: config.current
    }
})

ipcMain.handle('CHANGE_UID', (event, uid) => {
    config.current = uid
})

ipcMain.handle('GET_CONFIG', () => {
    return config.value()
})

ipcMain.handle('LANG_MAP', () => {
    return langMap
})

ipcMain.handle('SAVE_CONFIG', (event, [key, value]) => {
    config[key] = value
    config.save()
})

ipcMain.handle('DISABLE_PROXY', async () => {
    await disableProxy()
})

ipcMain.handle('I18N_DATA', () => {
    return i18n.data
})

ipcMain.handle('OPEN_CACHE_FOLDER', () => {
    if (config["cacheFolder"]) {
        shell.openPath(config["cacheFolder"])
    }
})

ipcMain.handle('COPY_URL', async () => {
    const url = await getUrl()
    if (url) {
        clipboard.writeText(url)
        return true
    }
    return false
})

exports.getData = () => {
    return {
        dataMap, current: config.current
    }
}

exports.saveData = saveData

exports.changeCurrent = changeCurrent
