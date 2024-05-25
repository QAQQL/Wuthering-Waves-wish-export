const itemTypeNameMap = require('../gachaType.json')

const order = ['1', '2', '3', '4', '5', '6']

function convertItemTypeMap(mapObject) {
    const convertedItemTypeMap = new Map()
    order.forEach(id => {
        const itemType = mapObject.find(item => {
            return item.key === id
        })
        convertedItemTypeMap.set(itemType.key, itemType.name)
    })
    return convertedItemTypeMap
}

exports.getItemTypeNameMap = function (language) {
    const lang = Object.keys(itemTypeNameMap).find(key => key.startsWith(language + '-')) || 'zh-cn'
    return convertItemTypeMap(itemTypeNameMap[lang])
}