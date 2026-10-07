# 地铁隧道环片裂缝复测台账（sologsb101-1006）

面向地铁运营隧道结构维保班组与第三方监测单位，把区间内每环管片的裂缝逐条建档，并按测次复测比对裂缝发展情况。核心动作：录入区间与环片里程、登记裂缝部位与走向、按测次复测宽度长度、算发展速率、给出整治建议。

> 纯前端单页应用（SPA）：**无后端 / 无数据库服务 / 无 API**，全部数据保存在浏览器本地 IndexedDB。

## 一、Docker 一键启动（推荐）

在项目根目录（本 README 所在目录）执行：

```bash
cp .env.example .env && docker compose up -d --build
```

启动完成后访问：**http://localhost:22806**

常用运维命令：

```bash
docker compose ps                 # 查看容器状态
docker compose logs -f frontend   # 查看 nginx 日志
docker compose down               # 停止并删除容器
docker compose up -d --build      # 改代码后重新构建启动
```

如需更换宿主端口，修改 `.env` 中的 `FRONTEND_PORT` 后重新 `docker compose up -d`。

## 二、技术栈

| 层次 | 选型 | 说明 |
| --- | --- | --- |
| 框架 | Vue 3.5 | `<script setup>` + Composition API |
| 语言 | TypeScript 5.7 | `strict` 严格模式，构建前执行 `vue-tsc --noEmit` |
| UI 组件 | Element Plus 2.9 | 表格、表单、弹窗、抽屉、标签、进度 |
| 状态管理 | Pinia 2.3 | `sectionStore` / `crackStore` / `surveyStore` |
| 路由 | Vue Router 4.5 | History 模式，nginx `try_files` 回退 |
| 本地持久化 | Dexie 4（IndexedDB） | 版本号 + `upgrade` 迁移 + 幂等播种 |
| 构建 | Vite 6 | 输出 `dist/`，按路由自动分包 |
| 运行 | nginx:alpine | 静态托管 + gzip + SPA 回退 |

## 三、目录结构

```
sologsb101-1006/
├── README.md
├── docker-compose.yml          # 不写 version；顶层 name: gbtunnelcrack
├── .env / .env.example         # COMPOSE_PROJECT_NAME、FRONTEND_PORT
├── .gitignore
└── frontend/
    ├── Dockerfile              # node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf              # try_files $uri $uri/ /index.html + gzip
    ├── .dockerignore
    ├── package.json / tsconfig.json / vite.config.ts / index.html
    ├── public/favicon.svg
    └── src/
        ├── types/              # section.ts ring.ts crack.ts survey.ts advice.ts
        ├── stores/             # sectionStore.ts crackStore.ts surveyStore.ts
        ├── components/common/  # LevelTag.vue FilterBar.vue StatBadge.vue EmptyPanel.vue
        ├── hooks/              # useCrackTrend.ts useIdbTable.ts
        ├── pages/              # SectionList.vue CrackEntry.vue SurveyCompare.vue TrendBoard.vue BackupView.vue
        ├── router/index.ts
        ├── utils/              # rate.ts db.ts export.ts
        ├── styles/main.css
        ├── App.vue
        └── main.ts
```

## 四、页面与路由

| 路由 | 页面 | 消费模型 | 主要交互 |
| --- | --- | --- | --- |
| `/sections` | 区间与环片里程台账 | Section、Ring | 新建/编辑/删除区间与环片；按线路、结构型式筛选；里程区间二维筛选；展开环片查看裂缝 |
| `/cracks` | 裂缝初测录入 | Crack、Ring | 新增/编辑/删除裂缝；勾选批量改状态；单条状态流转（观察→待整治→已整治）；导出 CSV |
| `/surveys` | 复测测次与变化量对比 | Survey、Crack | 按测次追加读数（自动比对生成变化量）；SVG 折线对比历次宽度；编辑/删除测次；误录测次作废（必填原因、保留原值）与恢复 |
| `/trends` | 发展速率分级与预警 | Crack、Survey、Advice | 按最新有效测次月均速率降序排行；仅看预警开关；一键生成整治建议草稿；等级不一致的建议标「待复核」；抽屉查看测次序列 |
| `/backup` | 整治建议与数据备份 | 全部模型 | 建议状态流转（待下发→已下发→已完成）；待复核建议计数与标记；导出/导入全量 JSON（含作废状态）；导出 CSV；清空/重置演示数据 |

## 五、数据存储说明

- **IndexedDB 库名**：`gbtunnelcrack`（Dexie 封装，`src/utils/db.ts`）
- **对象表**：`sections`、`rings`、`cracks`、`surveys`、`advices`
- **数据结构版本**：`DB_VERSION = 3`，含 `version(1)` → `version(2)` → `version(3)` 的迁移链：v2 补齐行修订号 `revision`、用所属环片回填历史裂缝的 `sectionId` 冗余列、补齐缺失的变化量字段；v3 为全部测次补齐作废字段（`voided` / `voidReason` / `voidedAt`），索引结构不变
- **首屏自动播种**：`initDatabase()` 中 `if (await db.sections.count() === 0) await seedDatabase()`，播种 2 个区间 → 5 个环片 → 6 条裂缝 → 15 个测次（含 1 条已作废的误录演示记录）→ 4 条建议的互相引用演示数据；播种为幂等操作，重复调用不会重复插入
- **localStorage 辅助键**：`gbtunnelcrack:db-version`（结构版本号）、`gbtunnelcrack:last-backup-at`（最近备份时间）、`gbtunnelcrack:ui-prefs`（上次选中区间、仅看预警开关）
- 应用为**无状态容器**：数据不落容器磁盘、不使用数据库服务、不挂载命名卷；清理浏览器数据即清空业务数据（可在 `/backup` 页重新播种）

## 六、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:22806
npm run build      # vue-tsc --noEmit && vite build（类型检查 + 生产构建）
npm run preview    # 本地预览构建产物
```

> 提示：开发时浏览器直接使用本机 IndexedDB；若与 Docker 版本混用同一浏览器，数据是同一份（同源端口不同则为不同源，数据互相独立）。

## 七、判定口径

- 月均速率 `mm/月 = (本次宽度 − 上次宽度) ÷ 间隔天数 × 30`（只沿**有效测次链**计算）
- 分级阈值：`< 0.10` 一般，`0.10 ~ 0.25` 较重，`≥ 0.25` 严重
- 预警数 = 速率分级为「较重」及以上的裂缝数量
- **有效测次口径**：误录测次可「作废」——必填作废原因、原值保留、测次链位置保留，但不再参与台账当前宽度/长度、变化量、速率与预警计算（一律按最新**有效**测次取值，避免台账停在误录值）；「恢复」后按日期重新纳入计算。初测（首条有效测次）不能作废
- **待复核**：历史整治建议的措施与状态保留不变；建议等级与最新有效分级不一致时，在速率排行页与建议页标「待复核」，并在 CSV 的「等级复核」列输出
- 全量 JSON 备份与 CSV 导出均携带测次作废状态（`voided` / `voidReason` / `voidedAt`）与有效测次计算结果；导入旧版存档时自动按「未作废」补齐作废字段
