# IPTV Admin

一个面向个人和小团队的 IPTV 直播源管理后台。项目提供直播源导入、外部订阅同步、可用性测速、EPG 节目单聚合、大模型频道归一化优化、M3U/TXT 订阅导出、用户权限管理等能力。

本项目由一个 Node.js/Express 后端、一个 React/Ant Design 前端和 SQLite 数据库组成。生产环境可以通过 Docker 一键运行，开发环境可以分别启动前后端。

## 功能概览

- 直播源管理
  - 手动新增、批量导入、编辑、删除、清空直播源。
  - 支持 M3U、M3U8、TXT 等常见直播源文本格式导入。
  - 支持按频道名称、分组、状态、协议、来源、运营商、冷冻状态等条件筛选。
  - 支持单条测速、批量测速、全量测速、增量测速。
  - 支持预览播放 HLS/m3u8 或浏览器可播放的普通视频流。

- 外部订阅管理
  - 添加多个外部直播源订阅。
  - 支持单个订阅同步和全部订阅同步。
  - 支持自定义 User-Agent。
  - 支持自动更新开关和定时同步。

- 直播源测速与质量筛选
  - 测试直播源 HTTP 可访问性、首包延迟、下载速度、协议、地区、运营商、画质、编码。
  - HLS/m3u8 源会解析真实媒体分片测速，不使用固定模拟速度。
  - 直连流会读取真实媒体数据采样测速。
  - 失败源支持失败计数和冷冻机制，避免反复检测明显不可用源。
  - 导出时可按有效状态、速度优先、延迟次优排序。

- 大模型优化直播源
  - 调用兼容 OpenAI Chat Completions 的大模型接口。
  - 自动清洗频道名称，例如将多种 CCTV 写法归一为规范名称。
  - 自动合并分组，例如央视、卫视、北京、港澳台、日本、韩国、国际、省级分组、景区、直播、电影、广播、音乐、游戏、其它等。
  - 支持全部优化和增量优化。
  - 支持优化结果逐批写入，不必等待全部模型任务结束。
  - 支持手动修正优化后分组。
  - 支持在优化列表中测试对应原始直播源，并同步刷新优化结果。

- 发布与导出
  - 支持导出 M3U 和 TXT。
  - 支持 IPv4、IPv6 单独导出。
  - 支持选择原始源或大模型优化源作为导出数据源。
  - 支持仅导出有效源。
  - 支持每个频道限制最大线路数。
  - 支持按分类顺序导出：
    `央视、卫视、北京、港澳台、日本、韩国、国际、其它省级、景区、直播、电影、广播、音乐、游戏、其它、剩余分组`
  - 支持导出 Token 防盗链。

- EPG 节目单
  - 支持添加多个 EPG XML 地址。
  - 支持同步、合并并生成 `epg.xml` 与 `epg.xml.gz`。
  - 导出地址可供播放器订阅。

- 系统设置与用户管理
  - 支持测速并发、超时、最低速度、导出规则等配置。
  - 支持订阅同步、直播源检测、EPG 同步、优化任务定时计划。
  - 支持管理员创建用户、重置密码、删除用户。

## 技术栈

### 后端

- Node.js 22+
- Express
- SQLite (`node:sqlite`)
- JWT + bcryptjs
- node-cron
- ffmpeg / ffprobe
- ip2region-ts
- fast-xml-parser

### 前端

- React 19
- React Router
- Ant Design 6
- Axios
- hls.js
- Vite 8
- TypeScript
- oxlint

### 数据存储

- SQLite 数据库，默认路径：
  - 本地开发：`backend/data/iptv.sqlite`
  - Docker：`./data/iptv.sqlite` 挂载到容器 `/app/data/iptv.sqlite`

## 目录结构

```text
.
├── Dockerfile                  # 生产镜像构建文件，包含前端构建和后端运行环境
├── docker-compose.yml          # Docker Compose 一键部署配置
├── README.md                   # 项目说明文档
├── backend/                    # Node.js 后端
│   ├── server.js               # Express 入口
│   ├── db.js                   # SQLite 初始化、默认配置、默认用户
│   ├── tester.js               # 直播源检测与测速
│   ├── sync.js                 # 外部订阅同步
│   ├── epg.js                  # EPG 同步与合并
│   ├── optimizer.js            # 大模型优化任务
│   ├── scheduler.js            # 定时任务
│   ├── geoip.js                # IP 地区与运营商识别
│   ├── routes/                 # 后端 API 路由
│   ├── data/                   # 本地开发数据库和 ip2region 数据
│   └── public/                 # 生产环境前端静态文件与导出 EPG
├── frontend/                   # React 前端
│   ├── src/
│   │   ├── pages/              # 页面
│   │   ├── components/         # 通用组件
│   │   └── utils/              # API、时间工具等
│   ├── vite.config.ts
│   └── package.json
├── data/                       # Docker 挂载数据库目录
└── iptv-api/                   # 上游/参考 IPTV API 子项目，当前后台不依赖它启动
```

## 快速开始：Docker 部署

推荐生产环境使用 Docker Compose。

### 1. 准备环境

需要安装：

- Docker
- Docker Compose

### 2. 启动服务

```bash
docker compose up -d --build
```

启动后访问：

```text
http://localhost:4010
```

默认账号：

```text
用户名：admin
密码：admin2026
```

首次登录后建议立刻修改密码，并在生产环境中修改 `JWT_SECRET`。

### 3. 查看日志

```bash
docker compose logs -f iptv-admin
```

### 4. 停止服务

```bash
docker compose down
```

### 5. 数据持久化

Docker Compose 默认将本机 `./data` 挂载到容器 `/app/data`：

```yaml
volumes:
  - ./data:/app/data
```

数据库文件位于：

```text
./data/iptv.sqlite
```

备份时直接备份这个文件即可。

## Docker 镜像源配置

根目录 `Dockerfile` 默认使用国内镜像参数，便于网络环境不稳定时构建：

```yaml
args:
  NODE_IMAGE: ${NODE_IMAGE:-docker.m.daocloud.io/library/node:22-alpine}
  NPM_REGISTRY: ${NPM_REGISTRY:-https://registry.npmmirror.com}
  ALPINE_MIRROR: ${ALPINE_MIRROR:-https://mirrors.aliyun.com/alpine}
```

如果你的环境可以直接访问 Docker Hub 和 npm 官方源，可以这样覆盖：

```bash
NODE_IMAGE=node:22-alpine \
NPM_REGISTRY=https://registry.npmjs.org \
ALPINE_MIRROR=https://dl-cdn.alpinelinux.org/alpine \
docker compose up -d --build
```

## 本地开发启动

### 1. 环境要求

- Node.js 22+
- npm
- ffmpeg / ffprobe

macOS 可用 Homebrew 安装 ffmpeg：

```bash
brew install ffmpeg
```

Ubuntu/Debian：

```bash
sudo apt update
sudo apt install -y ffmpeg
```

### 2. 安装依赖

后端：

```bash
cd backend
npm install
```

前端：

```bash
cd frontend
npm install
```

### 3. 启动后端

```bash
cd backend
npm run dev
```

后端默认监听：

```text
http://localhost:4010
```

### 4. 启动前端

另开一个终端：

```bash
cd frontend
npm run dev
```

前端默认访问：

```text
http://localhost:5173
```

开发模式下，前端 API 基础地址配置在 `frontend/src/utils/api.ts`：

```ts
baseURL: import.meta.env.DEV ? 'http://localhost:4010' : ''
```

因此开发时前端 `5173` 会请求后端 `4010`。

## 环境变量

后端支持以下主要环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `4010` | 后端 HTTP 监听端口 |
| `DATABASE_PATH` | `./data/iptv.sqlite` | SQLite 数据库路径 |
| `JWT_SECRET` | `iptv-admin-secret-2026` | JWT 签名密钥，生产环境必须修改 |
| `NODE_ENV` | 无 | 生产镜像中设为 `production` |

Docker Compose 示例：

```yaml
environment:
  - PORT=4010
  - JWT_SECRET=iptv-admin-secret-2026
  - DATABASE_PATH=/app/data/iptv.sqlite
```

生产环境建议把 `JWT_SECRET` 改成随机强密钥，例如：

```bash
openssl rand -hex 32
```

## 默认初始化数据

首次启动时，系统会自动创建 SQLite 表并写入默认管理员：

```text
admin / admin2026
```

同时会写入默认设置项，包括测速配置、导出配置、定时任务配置、大模型配置等。首次部署后建议进入“系统设置”页面检查并更新这些配置，尤其是：

- 管理员密码
- JWT Secret
- 大模型 API Key
- 大模型 Base URL
- 大模型模型名
- 公开导出 Token

## 页面说明

### 1. 信息概览

首页展示系统统计、来源/订阅统计、后台任务进度和快捷操作。常用操作包括：

- 同步所有外部订阅
- 同步抓取 EPG 节目单
- 检测全部直播源
- 检测增量直播源
- 优化全量直播源
- 清空优化直播源

后台任务进度会显示当前任务完成数、成功数、失败数等信息。

### 2. 直播源列表

直播源列表管理所有原始直播源，来源包括：

- 手动新增
- 批量导入
- 外部订阅同步

支持的操作：

- 新增直播源
- 导入 M3U/TXT 内容
- 一键去重
- 清空全部直播源
- 单条预览
- 单条测速
- 单条编辑
- 单条删除
- 批量测试
- 批量删除

列表中的核心字段：

- 频道名称
- 分组
- 来源/订阅
- URL
- 状态：有效、失效、测试中、未知
- 协议：IPv4、IPv6
- 延迟
- 速度
- 画质
- 最近测试时间

所有同步时间和检测时间以北京时间展示，格式为：

```text
MM-DD hh:mm:ss
```

### 3. 外部订阅

订阅页用于管理外部 M3U/TXT 订阅地址。

字段：

- 订阅名称
- 订阅地址
- User-Agent
- 是否自动更新
- 同步状态
- 最近同步时间

支持：

- 新增订阅
- 编辑订阅
- 删除订阅
- 单独同步
- 同步全部订阅

同步时系统会解析订阅内容并写入 `sources` 表。

### 4. 优化直播源

优化直播源是基于原始直播源生成的“可导出优化结果”。它不会替代原始直播源，而是写入 `optimized_sources` 表。

支持：

- 全部优化：先清空优化结果，再优化所有有效原始直播源。
- 增量优化：仅优化尚未进入优化表、且状态有效的原始直播源，不清空现有优化结果。
- 测试：测试该优化源关联的原始直播源，并同步刷新优化源状态。
- 编辑：只允许手动修改优化源分组，其它信息只读展示。
- 删除频道：按优化后的频道名称删除同名线路。
- 批量删除。
- 清空全部优化结果。

大模型优化会逐批处理，模型每返回一批结果就立即写入数据库。

### 5. 发布与导出

发布页用于生成播放器可订阅地址。可选择：

- 数据源：原始直播源 / 优化直播源
- 格式：M3U / TXT
- 协议：全部 / IPv4 / IPv6
- 是否仅包含有效源
- 每个频道最多保留多少条线路
- 包含哪些频道分组

导出排序逻辑：

1. 先按分组顺序排序：
   `央视、卫视、北京、港澳台、日本、韩国、国际、其它省级、景区、直播、电影、广播、音乐、游戏、其它、剩余分组`
2. 同一分组内按频道名称排序。
3. 同一频道内按质量排序：
   - 有效源优先
   - 速度高的优先
   - 延迟低的次优

### 6. EPG 管理

EPG 页面用于维护节目单 XML 地址。

支持：

- 新增 EPG 地址
- 编辑 EPG 地址
- 删除 EPG 地址
- 同步并合并 EPG
- 生成 `epg.xml`
- 生成 `epg.xml.gz`

### 7. 系统设置

设置页包含：

- 测速与过滤配置
- 导出配置
- 大模型配置
- 定时任务配置
- 用户管理

管理员可以创建用户、重置密码、删除用户。

## 直播源测速逻辑

测速入口位于 `backend/tester.js`。

### 基本流程

1. 解析直播源 URL。
2. DNS 解析域名，获取 IP。
3. 查询 IP 地区和运营商。
4. 发起 HTTP 请求，记录首包延迟。
5. 判断是否为 HLS/m3u8。
6. 按不同类型执行测速。
7. 如果可用，更新状态、速度、延迟、协议、地区、运营商、画质、编码。
8. 如果失败，增加失败计数，达到阈值后进入冷冻。

### HLS/m3u8 测速

HLS 源不会使用固定速度。系统会：

- 下载 m3u8 playlist。
- 如果是 master playlist，进入码率最高的子 playlist。
- 解析真实媒体分片 URL。
- 下载前几个媒体分片样本。
- 按真实读取字节数和耗时计算 MB/s。

### 直连流测速

普通 TS/MP4/HTTP 流会从响应体读取真实媒体数据样本，根据读取字节数和耗时计算速度。

### 冷冻机制

连续失败达到阈值后，直播源会被冷冻一段时间。冷冻源在检测任务中会跳过，避免浪费测速资源。可在首页快捷操作中重置冷冻失效源。

## 大模型优化逻辑

优化入口位于 `backend/optimizer.js`。

### 模型接口要求

接口需要兼容 OpenAI Chat Completions 格式：

```text
POST {llmBaseUrl}/chat/completions
Authorization: Bearer {llmApiKey}
```

请求体示例：

```json
{
  "model": "your-model-name",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "[...]" }
  ],
  "temperature": 0.1
}
```

模型必须返回紧凑 JSON 数组：

```json
[
  { "id": 1, "name": "CCTV-1", "category": "央视" }
]
```

如果要剔除广告、公告、非直播频道，可以返回：

```json
{ "id": 1, "name": "xxx", "category": "delete" }
```

或者直接忽略该 ID。

### 分组规则

当前提示词要求尽量归入以下分类：

```text
央视、卫视、北京、港澳台、日本、韩国、国际、其它省级行政区、景区、直播、电影、广播、音乐、游戏、其它、剩余无法归类的原始分组
```

省市类分组只允许省级，不细化到城市或区县：

- 北京单独归入 `北京`
- 上海、天津、重庆按直辖市作为省级分组
- 广州、深圳归并为广东
- 杭州归并为浙江
- 成都归并为四川
- 南京归并为江苏

### 全部优化与增量优化

- 全部优化：
  - 清空 `optimized_sources`
  - 读取所有 `status = active` 的原始源
  - 分批提交给模型
  - 逐批写入优化结果

- 增量优化：
  - 不清空 `optimized_sources`
  - 只读取 `status = active` 且还没有优化结果的原始源
  - 逐批写入优化结果

## 导出地址

以下地址不需要登录，但如果系统设置了公开导出 Token，则必须附加：

```text
?token=你的Token
```

### 全量导出

| 地址 | 说明 |
| --- | --- |
| `/m3u` | 导出 M3U |
| `/txt` | 导出 TXT |

示例：

```text
http://localhost:4010/m3u
http://localhost:4010/txt
```

### IPv4 / IPv6 导出

| 地址 | 说明 |
| --- | --- |
| `/ipv4` | 按默认格式导出 IPv4 |
| `/ipv6` | 按默认格式导出 IPv6 |
| `/ipv4/m3u` | 导出 IPv4 M3U |
| `/ipv4/txt` | 导出 IPv4 TXT |
| `/ipv6/m3u` | 导出 IPv6 M3U |
| `/ipv6/txt` | 导出 IPv6 TXT |

示例：

```text
http://localhost:4010/ipv4/m3u
http://localhost:4010/ipv6/txt
```

### EPG 导出

| 地址 | 说明 |
| --- | --- |
| `/epg.xml` | XML 节目单 |
| `/epg.xml.gz` | gzip 压缩节目单 |

示例：

```text
http://localhost:4010/epg.xml
http://localhost:4010/epg.xml.gz
```

### 常用查询参数

| 参数 | 示例 | 说明 |
| --- | --- | --- |
| `token` | `?token=abc` | 公开导出 Token |
| `mode` | `mode=optimized` | 使用优化源导出，可选 `original` / `optimized` |
| `only_active` | `only_active=1` | 仅导出有效源 |
| `limit_per_channel` | `limit_per_channel=3` | 每个频道最多保留几条线路 |
| `categories` | `categories=央视,卫视` | 只导出指定分组 |
| `isp` | `isp=电信` | 按运营商过滤 |
| `region` | `region=广东` | 按地区过滤 |

示例：

```text
http://localhost:4010/m3u?mode=optimized&only_active=1&limit_per_channel=3
http://localhost:4010/ipv4/m3u?mode=optimized&categories=央视,卫视&token=abc
```

## 后端 API 简表

管理 API 均以 `/api` 开头，大部分需要 `Authorization: Bearer <token>`。

### 认证

| 方法 | 地址 | 说明 |
| --- | --- | --- |
| `POST` | `/api/auth/login` | 登录 |
| `GET` | `/api/auth/me` | 当前用户 |

### 直播源

| 方法 | 地址 | 说明 |
| --- | --- | --- |
| `GET` | `/api/sources` | 查询直播源列表 |
| `GET` | `/api/sources/:id` | 查询单条直播源 |
| `POST` | `/api/sources` | 新增直播源 |
| `PUT` | `/api/sources/:id` | 修改直播源 |
| `DELETE` | `/api/sources` | 批量删除直播源 |
| `POST` | `/api/sources/import` | 批量导入直播源 |
| `POST` | `/api/sources/test` | 启动检测任务 |
| `GET` | `/api/sources/test/status` | 检测任务状态 |
| `POST` | `/api/sources/test/stop` | 停止检测任务 |
| `POST` | `/api/sources/deduplicate` | 去重 |
| `POST` | `/api/sources/clear` | 清空直播源 |
| `POST` | `/api/sources/defrost` | 重置冷冻源 |

### 订阅

| 方法 | 地址 | 说明 |
| --- | --- | --- |
| `GET` | `/api/subscriptions` | 查询订阅列表 |
| `POST` | `/api/subscriptions` | 新增订阅 |
| `PUT` | `/api/subscriptions/:id` | 修改订阅 |
| `DELETE` | `/api/subscriptions/:id` | 删除订阅 |
| `POST` | `/api/subscriptions/sync` | 同步全部订阅 |
| `GET` | `/api/subscriptions/sync/status` | 同步状态 |
| `POST` | `/api/subscriptions/:id/sync` | 同步单个订阅 |

### 优化源

| 方法 | 地址 | 说明 |
| --- | --- | --- |
| `GET` | `/api/optimizer` | 查询优化源列表 |
| `POST` | `/api/optimizer/run` | 全部优化 |
| `POST` | `/api/optimizer/run-incremental` | 增量优化 |
| `GET` | `/api/optimizer/status` | 优化任务状态 |
| `POST` | `/api/optimizer/stop` | 停止优化任务 |
| `PUT` | `/api/optimizer/:id` | 修改优化源分组 |
| `DELETE` | `/api/optimizer` | 删除指定优化源 |
| `DELETE` | `/api/optimizer/channel` | 按频道名删除优化源 |
| `POST` | `/api/optimizer/clear` | 清空优化源 |

### EPG

| 方法 | 地址 | 说明 |
| --- | --- | --- |
| `GET` | `/api/epg` | 查询 EPG 源 |
| `POST` | `/api/epg` | 新增 EPG 源 |
| `PUT` | `/api/epg/:id` | 修改 EPG 源 |
| `DELETE` | `/api/epg/:id` | 删除 EPG 源 |
| `POST` | `/api/epg/sync` | 同步并合并 EPG |
| `GET` | `/api/epg/sync/status` | EPG 同步状态 |

### 设置与用户

| 方法 | 地址 | 说明 |
| --- | --- | --- |
| `GET` | `/api/settings` | 获取设置 |
| `POST` | `/api/settings` | 保存设置 |
| `GET` | `/api/settings/users` | 管理员查询用户 |
| `POST` | `/api/settings/users` | 管理员创建用户 |
| `PUT` | `/api/settings/users/:id/password` | 管理员重置密码 |
| `DELETE` | `/api/settings/users/:id` | 管理员删除用户 |

## 系统设置项说明

| Key | 默认值 | 说明 |
| --- | --- | --- |
| `concurrency` | `5` | 测速最大并发数 |
| `timeout` | `10000` | 单源测试超时时间，单位 ms |
| `minSpeed` | `0.2` | 合格直播源最低速度，单位 MB/s |
| `onlyActive` | `1` | 导出时默认仅包含有效源 |
| `limitPerChannel` | `5` | 每个频道导出最大线路数 |
| `blacklist` | `bxtv.3a.ink\n/audio/` | 黑名单关键字 |
| `whitelist` | 空 | 白名单关键字 |
| `alias` | `央视网,CCTV\n高清,` | 频道别名/清洗规则 |
| `syncCron` | `0 */4 * * *` | 订阅同步 Cron |
| `testCron` | `0 2 * * *` | 直播源检测 Cron |
| `epgCron` | `0 3 * * *` | EPG 同步 Cron |
| `optimizeCron` | 可配置 | 大模型优化 Cron |
| `exportToken` | 空 | 公开导出 Token |
| `logoRepositoryUrl` | 默认台标库地址 | 自动匹配台标基础路径 |
| `defaultExportFormat` | `m3u` | `/ipv4`、`/ipv6` 默认格式 |
| `llmApiKey` | 需自行配置 | 大模型 API Key |
| `llmBaseUrl` | 需自行配置 | 大模型 Base URL |
| `llmModelName` | 需自行配置 | 大模型名称 |
| `llmDefaultMode` | `original` | 默认导出数据模式 |
| `llmChunkSize` | `80` | 每批提交给大模型的源数量 |

## Cron 表达式示例

| 表达式 | 含义 |
| --- | --- |
| `0 */4 * * *` | 每 4 小时执行一次 |
| `0 2 * * *` | 每天 02:00 执行 |
| `0 3 * * *` | 每天 03:00 执行 |
| `*/30 * * * *` | 每 30 分钟执行一次 |
| 空字符串 | 关闭对应定时任务 |

## 数据库表说明

### `users`

用户表，保存用户名、密码哈希、角色。

### `subscriptions`

外部直播源订阅表。

### `sources`

原始直播源表。所有导入、同步得到的直播源都会进入这里。

核心字段：

- `name`
- `url`
- `category`
- `origin`
- `subscription_id`
- `status`
- `delay`
- `speed`
- `resolution`
- `codec`
- `fail_count`
- `frozen_until`
- `last_tested_at`

### `optimized_sources`

大模型优化后的直播源表。它通过 `original_source_id` 关联原始直播源。

### `epg_sources`

EPG 订阅源表。

### `settings`

系统设置表。

## 备份与迁移

### Docker 部署

备份：

```bash
cp ./data/iptv.sqlite ./data/iptv.sqlite.bak
```

恢复：

```bash
docker compose down
cp ./data/iptv.sqlite.bak ./data/iptv.sqlite
docker compose up -d
```

### 本地开发

备份：

```bash
cp backend/data/iptv.sqlite backend/data/iptv.sqlite.bak
```

恢复：

```bash
cp backend/data/iptv.sqlite.bak backend/data/iptv.sqlite
```

## 构建生产前端

如需手动构建前端并放到后端：

```bash
cd frontend
npm run build
```

构建产物位于：

```text
frontend/dist
```

Docker 构建时会自动执行前端构建，并复制到后端运行目录：

```text
/app/public
```

## 代码检查

前端 lint：

```bash
cd frontend
npm run lint
```

前端构建：

```bash
cd frontend
npm run build
```

后端语法检查示例：

```bash
node --check backend/server.js
node --check backend/tester.js
node --check backend/optimizer.js
```

## 常见问题

### 1. Docker 构建卡在 `node:22-alpine`

可能是 Docker Hub 访问不稳定。项目默认使用了镜像参数：

```text
docker.m.daocloud.io/library/node:22-alpine
```

也可以自定义：

```bash
NODE_IMAGE=你的Node镜像 docker compose up -d --build
```

### 2. 测速结果都是 0 或失效

检查：

- 服务器是否能访问直播源 URL。
- 是否安装 ffmpeg/ffprobe。
- 直播源是否限制 User-Agent。
- 系统设置里的超时时间是否太短。
- 最低速度限制 `minSpeed` 是否过高。
- 并发数是否过高导致网络拥塞。

### 3. HLS 源浏览器能打开，但后台测速失败

可能原因：

- 分片 URL 需要特殊 Header。
- 源站限制服务器 IP。
- 源站需要 Referer 或特定 User-Agent。
- m3u8 是短期签名地址，过期后无法下载。

可以在订阅或直播源配置中调整 User-Agent，或降低检测并发。

### 4. 导出地址访问 403

如果设置了公开导出 Token，所有导出地址都需要附加：

```text
?token=你的Token
```

例如：

```text
http://localhost:4010/m3u?token=abc
```

### 5. 播放器里频道顺序不对

检查发布页是否选择了正确的数据源：

- 原始直播源
- 优化直播源

如果使用优化直播源，请先运行“全部优化”或“增量优化”。导出时会按内置分类顺序排序，并在同频道内按有效、速度、延迟排序。

### 6. 优化直播源没有数据

可能原因：

- 原始直播源没有检测为有效。
- 大模型配置不完整。
- 大模型返回内容不是合法 JSON 数组。
- 优化任务正在运行但还未写入结果。

建议先执行：

1. 检测全部直播源。
2. 确认有效源数量。
3. 配置大模型。
4. 执行全部优化。

### 7. EPG 地址返回 404

需要先在 EPG 页面添加 EPG 源并执行同步。同步成功后才会生成：

```text
backend/public/epg.xml
backend/public/epg.xml.gz
```

Docker 生产环境中对应容器内路径是：

```text
/app/public/epg.xml
/app/public/epg.xml.gz
```

### 8. 默认账号不安全

默认账号只用于首次初始化：

```text
admin / admin2026
```

生产环境必须修改密码，并建议：

- 修改 `JWT_SECRET`
- 设置导出 Token
- 不要直接暴露后台到公网，或至少加反向代理鉴权

## 安全建议

- 首次登录后立即修改默认管理员密码。
- 生产环境必须修改 `JWT_SECRET`。
- 设置公开导出 Token，避免订阅地址被随意访问。
- 如果暴露到公网，建议放在 Nginx、Caddy、Traefik 等反向代理后面，并启用 HTTPS。
- 定期备份 SQLite 数据库。
- 不要把真实的大模型 API Key 提交到公开仓库。

## 维护建议

- 外部订阅建议设置合理同步频率，不要过于频繁。
- 测速并发建议从 5 开始，根据服务器带宽逐步调整。
- 对大型直播源库，建议先检测有效源，再运行大模型优化。
- 优化源适合作为播放器订阅的最终输出，原始源适合作为数据池保留。
- 如果频道名/分组不理想，优先调整大模型提示词或手动修正优化源分组。

## License

当前仓库未在根目录声明明确许可证。`iptv-api/` 子项目包含其自身许可证文件，根项目许可证请以后续仓库声明为准。

