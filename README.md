# Zotero Vocabulary Builder

Zotero Vocabulary Builder 是一个面向文献阅读场景的 Zotero 生词助手。阅读英文论文、图书或笔记时，选中单词并按 `Alt+A`，插件会把生词加入专属生词笔记，并自动补充翻译、释义、词性和音标。

## 主要功能

- `Alt+A` 快捷添加：在 Zotero 阅读器中选中英文单词后快速加入生词表。
- 自动翻译：默认使用内置翻译源，也可在设置中切换到免费词典或自定义 JSON API。
- 离线暂存：离线时先保存为待处理，联网后自动重试翻译。
- 生词笔记同步：所有生词集中写入 Zotero 笔记，便于回看、搜索和手动编辑。
- 多格式导出：支持 CSV、TSV、JSON、Anki、Quizlet、Mochi 等格式。
- 语言切换：设置页支持 `中文 / English` 一键切换，界面、提示和生词笔记标题会同步切换。
- 反馈与赞赏：设置页内置作者反馈邮箱复制按钮和微信赞赏码。

## 安装

1. 在项目构建后找到 `.scaffold/build/vocabulary-builder.xpi`。
2. 打开 Zotero，进入 `工具 -> 插件`。
3. 点击齿轮按钮，选择 `Install Add-on From File...`。
4. 选择 `vocabulary-builder.xpi` 并重启 Zotero。

## 快速使用

1. 打开 Zotero 中的 PDF 或笔记。
2. 用鼠标选中一个英文单词。
3. 按 `Alt+A` 添加到生词表。
4. 在 `工具` 菜单中打开生词笔记。
5. 在 `编辑 -> 设置 -> Vocabulary Builder` 中切换界面语言，并配置翻译 API、导出格式、反馈邮箱和赞赏信息。

## 设置说明

- 翻译 API：可选择内置有道、免费词典或自定义 JSON API。
- 语言切换：点击设置页顶部的 `中文 / English` 按钮，可在中文和英文界面之间切换。
- 自定义 JSON API：填写请求 URL、请求头和响应字段路径，例如 `data.translation`。
- 导出：选择导出范围和格式，可适配表格软件或常见背单词工具。
- 意见反馈：设置页固定展示反馈邮箱 `2278464424@qq.com`，可一键复制。
- 支持 / 打赏：设置页直接展示微信赞赏码，可扫码支持作者继续维护。

## 用户手册

完整手册见 [doc/USER_MANUAL.md](doc/USER_MANUAL.md)。

## 开发与构建

```sh
npm install
npm run build
```

构建产物位于 `.scaffold/build/`，其中 `vocabulary-builder.xpi` 是可安装的 Zotero 插件包。

## 反馈

如果你遇到问题或希望新增功能，请发送邮件到 `2278464424@qq.com`。建议附上 Zotero 版本、插件版本、复现步骤和截图。

## License

AGPL-3.0-or-later
