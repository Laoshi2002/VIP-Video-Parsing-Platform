# VIP 视频解析平台 — 设计文档

- 日期：2026-10-28
- 状态：设计已与用户逐节确认，待最终审阅

## 1. 背景与目标

构建一个免费、专业简洁的影视搜索播放网站，部署在 Cloudflare Pages，长期稳定可用：

- 搜索剧名/电影名 → 聚合多资源站片源 → 点击剧集自动解析播放
- 兼容粘贴爱奇艺/腾讯视频等页面链接，走 VIP 解析接口通道播放
- PC 与移动端响应式
- 片源/解析接口可动态热更新，无需改代码重新部署

## 2. 范围

### 做（基础版）

- 首页搜索：剧名关键词 或 粘贴视频链接（自动识别通道）
- 多源聚合搜索、同名同年份去重
- 详情页：剧集列表、同一部作品多片源切换
- hls.js 播放 m3u8；VIP 链接走 iframe 解析
- 深色主题、响应式（手机 / 平板 / PC）
- 片源列表热更新（远程 JSON 优先，内置兜底）

### 不做（明确排除）

- 收藏夹 / 观看历史 / 继续观看
- 用户系统、登录、云同步
- 源健康度统计与自动降权（后续可选迭代）
- 弹幕、皮肤、倍速记忆等播放器扩展功能

## 3. 总体架构

Cloudflare Pages + Pages Functions 一体化，单仓库单次部署：

```
repo/
├── public/                     # 静态前端（Pages 托管，构建输出目录）
│   ├── index.html              # 单页应用（hash 路由）
│   ├── assets/
│   │   ├── css/style.css
│   │   ├── js/app.js           # 视图与状态
│   │   ├── js/config.js        # 站点名、默认提示词等常量
│   │   └── vendor/hls.min.js   # 本地内置，不依赖第三方 CDN
│   └── sources.json            # 内置片源 + 解析接口配置
├── functions/                  # Pages Functions（同域 /api/*）
│   ├── api/search.js
│   ├── api/detail.js
│   └── lib/
│       ├── aggregate.js        # 并行请求、超时、聚合（纯函数）
│       ├── dedupe.js           # 去重合并（纯函数）
│       └── cms.js              # 苹果CMS V10 响应与 vod_play_url 解析（纯函数）
└── docs/
```

技术选型：原生 HTML/CSS/JS（无框架）；hls.js 本地 vendored；Functions 为 Node runtime。

数据流：

```
搜索剧名 → GET /api/search?wd=xx
           Function 并行 fetch 各采集源 ?ac=videolist&wd=xx（每源超时 5s，失败跳过）
           → 聚合去重 → 结果页海报网格
点击片源 → GET /api/detail?source=x&id=x
           Function fetch ?ac=videolist&ids=x，解析 vod_play_url → 剧集 m3u8 列表
点击剧集 → hls.js 直接播放资源站 m3u8 直链
```

## 4. 双通道设计

- **通道 A · 片源聚合（主）**：搜索剧名 → 采集 API → m3u8 直链播放
- **通道 B · VIP 解析（辅）**：搜索框内容匹配爱奇艺/腾讯/优酷/芒果/咪咕等 URL 正则时，进入解析视图：iframe 加载解析接口（`{接口地址}{视频页URL}`），提供"换线路"按钮顺序切换；解析接口列表维护在 sources.json

说明：解析接口必须允许 iframe 嵌入方可使用；单个接口不可用时用户手动换线路。

## 5. API 设计（Functions）

### GET /api/search?wd={关键词}

- 并行请求所有启用源，单源超时 5s，失败/超时静默跳过
- 去重规则：`vod_name` 相同且 `vod_year` 相同 → 合并为同一部，保留其全部来源；海报 `pic` 取首个有图源，`remark` 取集数信息最全者
- 响应（`Cache-Control: public, max-age=600`）：

```json
{
  "code": 1,
  "list": [
    {
      "name": "狂飙",
      "year": "2023",
      "pic": "https://...",
      "remark": "共39集",
      "sources": [ { "source_id": "a1", "vod_id": "123" }, { "source_id": "b2", "vod_id": "456" } ]
    }
  ]
}
```

### GET /api/detail?source={source_id}&id={vod_id}

- 定位对应源 → fetch `?ac=videolist&ids={vod_id}` → 解析 `vod_play_url`
- `vod_play_url` 格式：多个播放组以 `$$$` 分隔，组内以 `#` 分集，集内 `$` 分隔"名称$URL"；取第一组作为剧集列表，仅保留 `.m3u8` 结尾的 URL
- 响应（`Cache-Control: public, max-age=300`）：

```json
{
  "code": 1,
  "name": "狂飙",
  "pic": "https://...",
  "sourceName": "xx资源",
  "episodes": [ { "name": "第01集", "url": "https://.../1.m3u8" } ]
}
```

- 失败响应：`{ "code": 0, "msg": "获取片源详情失败" }`

## 6. sources.json（片源动态更新机制）

```json
{
  "remoteSourceUrl": "",
  "cmsSources": [
    { "id": "example1", "name": "示例资源1", "api": "https://host/api.php/provide/vod" }
  ],
  "parseApis": [
    { "name": "线路1", "url": "https://parser.example/?url=" }
  ]
}
```

- Functions 读取顺序：`remoteSourceUrl` 非空时先拉远程 JSON（内存缓存 5 分钟），失败或为空 → 回退内置文件
- 更新片源只需：改远程 JSON（即时生效）或改内置 sources.json 后重新部署
- 实施阶段：内置列表需预置若干个**经实测可用**的公开采集源与解析接口（实施时联网逐一验证后写入），保证验收标准 1、5 可通过

## 7. 页面设计（响应式）

三视图 hash 路由：`#/` 首页、`#/search?wd=` 结果页、`#/play?source=&id=&ep=` 播放页

- **首页**：Logo（站点名）+ 大搜索框 + 热门标签（config.js 静态词）+ 支持平台说明
- **结果页**：海报网格 + 标题 + remark；断点：≥1280px 6 列、≥768px 4 列、<768px 2 列
- **播放页**：16:9 播放器（PC 最大宽 1100px 居中）、剧集按钮网格、同作品多片源切换条、上一集/下一集
- **VIP 解析视图**：iframe + "换线路"按钮 + "返回搜索"
- **主题**：深色（背景 `#1a1d29` 系、主色 `#4f7cff`）；触摸目标 ≥44px；移动端单列堆叠、精简导航

## 8. 错误处理

| 场景 | 处理 |
| --- | --- |
| 单源搜索失败/超时 | 静默跳过，其余源照常返回 |
| 全部源搜索失败 | 提示"搜索失败，请稍后再试" |
| m3u8 播放失败 | hls.js ERROR 监听，自动重试 1 次 → 仍失败提示一键切换备用片源 |
| 详情拉取失败 | 提示并建议返回结果页换源 |
| 解析接口不可用 | 手动"换线路"按钮顺序切换 |

## 9. 验收标准

1. `wrangler pages dev` 本地全链路跑通：搜索 → 选源 → 播放
2. 聚合、去重、vod_play_url 解析纯函数单元测试全部通过
3. 375px / 768px / 1440px 视口无布局错乱
4. 含失效源场景：搜索仍返回其余源结果；播放失败出现换源提示
5. 粘贴爱奇艺/腾讯链接：至少一个可用线路时 iframe 解析可播放

## 10. 部署

- Cloudflare Pages 连接 Git 仓库自动构建：无构建命令，输出目录 `public`，`functions/` 自动识别
- 免费额度内运行，零固定成本
- 站点名等文案集中在 `public/assets/js/config.js`，占位"云影搜"
