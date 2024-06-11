const fs = require('fs');
const path = require('path');

// 读取简体中文的i18n文件
const zhFilePath = path.join( __dirname, '../i18n/简体中文.json');
const zhContent = JSON.parse(fs.readFileSync(zhFilePath, 'utf8'));

// 定义其他语言的i18n文件路径
const otherLangs = ['Deutsch.json', 'English.json', 'Español.json', 'Français.json', 'Indonesia.json', '日本語.json', '한국어.json', 'Português.json', 'Pусский.json', 'ภาษาไทย.json', 'Tiếng Việt.json', '繁體中文.json'];

otherLangs.forEach((langFile) => {
  const langFilePath = path.join(__dirname, `../i18n/${langFile}`);
  let langContent = JSON.parse(fs.readFileSync(langFilePath, 'utf8'));

  // 遍历简体中文的i18n文件，检查是否在当前语言的i18n文件中存在
  for (let key in zhContent) {
    if (!langContent.hasOwnProperty(key)) {
      langContent[key] = zhContent[key];  // 如果不存在，则添加该键，并将值设置为简体中文的值
    }
  }

  // 将更新后的i18n文件保存回磁盘
  fs.writeFileSync(langFilePath, JSON.stringify(langContent, null, 2), 'utf8');
});
