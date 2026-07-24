# 发布与上架说明

## 1. 当前状态

Zotero 生词笔记目前通过 GitHub Release 分发安装包，并已提交到社区插件索引 `syt2/zotero-addons-scraper`。

当前公开仓库：

- `Zzq-02/zotero-vocab-builder`

当前插件中文名：

- `Zotero 生词笔记`

## 2. 仓库中已准备好的内容

- 可安装插件包：`.scaffold/build/zotero-vocab-builder.xpi`
- 更新清单：`.scaffold/build/update.json`
- README 与中文使用手册
- GitHub Release 自动发布工作流
- `zotero-addons-scraper` 收录条目信息

## 3. 发新版的推荐流程

1. 修改功能或文档。
2. 更新 `package.json` 中的版本号，例如从 `1.0.0` 改为 `1.0.1`。
3. 本地运行 `npm run build`。
4. 提交代码并推送到 GitHub。
5. 创建并推送版本标签，例如 `v1.0.1`。
6. GitHub Actions 会根据标签自动生成 Release，并上传 `.xpi` 与 `update.json`。

推荐命令示例：

```sh
npm run build
git add .
git commit -m "chore: release v1.0.1"
git tag v1.0.1
git push github main --tags
```

## 4. 自动更新说明

插件安装包中的更新地址指向：

```text
https://github.com/Zzq-02/zotero-vocab-builder/releases/download/release/update.json
```

正式版本的 `.xpi` 下载地址格式为：

```text
https://github.com/Zzq-02/zotero-vocab-builder/releases/download/v{{version}}/zotero-vocab-builder.xpi
```

因此，正常发新版时应让 GitHub Actions 完成发布流程，避免手动上传时遗漏 `release/update.json`。

## 5. 插件索引维护

`syt2/zotero-addons-scraper` 的条目文件名为：

```text
Zzq-02@zotero-vocab-builder
```

条目内容为：

```json
{"tags": ["reader", "notes"]}
```

一般发新版不需要重新提交插件索引 PR。只有在仓库地址、插件分类标签或收录信息需要变更时，才需要再次更新该条目。

## 6. 对外展示重点

- `Alt+A` 快速收集阅读中的英文生词。
- 生词会保存到普通 Zotero 笔记中，便于搜索、同步和手动编辑。
- 可通过 Zotero 右侧笔记栏查看生词笔记。
- 来源链接可跳回 PDF 原始选取位置。
- 支持自动翻译、离线重试和多格式导出。
