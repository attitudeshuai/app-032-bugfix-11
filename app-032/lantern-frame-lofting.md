# 花灯骨架放样与蒙面裁片 · Lantern Frame Lofting

> 类型：前端 Web 应用（纯前端）｜难度：★★★｜技术栈：**Vue 3 + TypeScript + Vite**（`<script setup>` 单文件组件；SVG 放样图 + 几何计算；禁用 UI 组件库与图表库，见 README §5.1）

## 1. 一句话简介
做花灯不用再拿尺子在纸上比划：选一个灯型（宫灯、走马灯、莲花灯），填上直径和高度，直接出「每根竹篾要截多长、弯什么角度」和「每块蒙面要裁多大（含缝份）」的 1:1 放样图。

## 2. 真实场景与痛点
- 花灯/宫灯的骨架是竹篾或铁丝，长度差 5mm 就合不上口，老师傅靠经验放样，年轻人接不上手。
- **蒙面裁片更难**：灯体是立体的，绸布/宣纸要裁成平面再蒙上去，裁小了蒙不严、裁大了起皱；缝份（留多少黏边）没人说得清。
- 一个宫灯几十根篾、十几块裁片，手写清单容易漏、容易重。
- 放样图要**1:1**才能拓印到纸上用，普通打印机会缩放，导致整批尺寸偏差。
- 做一批灯（如 20 个同规格）要的材料量靠估，竹篾和绸布经常买多或买少。

## 3. 目标用户
- 花灯/宫灯制作作坊、非遗传承人。
- 学校与社区的手工课老师（做简易花灯）。
- 庙会/灯会承办方的制作组。

## 4. 核心功能（MVP）
1. **灯型选择**：正多棱柱（六角/八角宫灯）、旋转体（圆形灯笼、莲花灯）、多面体（正四面体/八面体的生肖灯底稿）、方形走马灯；可自定义棱数与收口方式（平口/收口/葫芦口）。
2. **参数设置**：最大直径、总高、收口直径、层数（分段高度）、棱数、蒙面类型（宣纸/绸布/羊皮纸）。
3. **骨架构件表（核心）**：
   - 每根篾的名称（竖篾/横篾/收口圈/底盘圈）、**截取长度（含两端绑扎余量，默认每端 +20mm）**、数量、弯曲半径（收口圈）；
   - 每层横篾圈的周长与直径；
   - 构件总数统计与竹篾总长（用于备料）。
4. **蒙面裁片放样（核心）**：把侧面展开成平面裁片，输出每块裁片的**实际尺寸 + 缝份（默认四边各 10mm）+ 对位标记位置**；顶/底盖单独出圆形裁片（含折边）。
5. **1:1 放样图**：SVG 按 1:1 输出，A4/A3 分页（**同一块裁片不拆到两页**），跨页处带对位十字与拼接编号；含 100mm 校验尺。
6. **材料统计**：竹篾/铁丝总长、蒙面布/纸面积（含损耗率）、扎线、胶、LED 灯珠（可选：按灯体体积给亮度建议）。
7. **导出**：放样图 PDF、构件清单（可打印）、裁片标签（每块裁片贴标签便于对号）。

## 5. 进阶功能
- 批量制灯：同规格 N 个的材料总量汇总（含 5% 损耗余量）。
- 灯身装饰分段配色（每层不同颜色，输出配色清单——不做 3D 渲染）。
- 收口曲线自定义（贝塞尔控制点，做葫芦形/花瓶形灯体）。
- 尺寸反推：给定现有竹篾长度，反推能做多大直径的灯。

## 6. 页面结构
```
/                 灯型选择与新建
/design/:id       参数与灯体预览（正视 + 俯视 + 展开图切换）
/frame/:id        骨架构件表（长度/数量/弯曲）
/panels/:id       蒙面裁片与缝份
/print/:id        1:1 放样图（分页与拼接标记）
/materials/:id    材料统计与备料单
```

## 7. 数据模型
```ts
type LanternKind = 'prism'|'revolution'|'polyhedron'|'box';
type Lantern = {
  id: string; kind: LanternKind; name: string;
  maxDiameterMm: number; totalHeightMm: number; mouthDiameterMm: number;
  sides: number;                // 棱数（prism/box）
  layers: { heightMm: number; diameterMm: number }[];   // 分段（旋转体/分层棱柱）
  mouthStyle: 'flat'|'taper'|'gourd'; smoothness: number; // 收口曲线强度
  covering: 'xuan'|'silk'|'parchment'; seamAllowanceMm: number; lashAllowanceMm: number;
};
type FrameMember = { id: string; kind: 'vertical'|'ring'|'mouth_ring'|'base_ring'|'rib'|'spoke';
                     label: string; lengthMm: number;                              // 已含绑扎余量
                     rawLengthMm: number; bendRadiusMm?: number; qty: number };
type Panel = { id: string; label: string; shape: 'trapezoid'|'rectangle'|'sector'|'circle'|'triangle';
               widthTopMm: number; widthBottomMm: number; heightMm: number;
               seamAllowanceMm: number;                     // 已加在尺寸里
               marksMm: { x: number; y: number; label: string }[];  // 对位标记
               qty: number };
type MaterialTally = { frameM: number; coveringM2: number; wasteRatio: number;
                       lashM: number; glueG: number; ledCount?: number };
```

## 8. 关键实现点
- **几何计算必须给公式并与之对齐**（这是放样准不准的根本）：
  ```
  正 n 棱柱底边（一根横篾）长 = 2 R sin(π/n)
  横篾圈周长 = 2πR（圆形）或 n × 底边长（多边形）
  竖篾长度 = 累计分段高（考虑收口曲率时按给定控制点对每段求折线长）
  收口圈弯曲半径：由 mouthDiameter 与收口段高决定，输出建议弯曲半径而非"随便弯"
  ```
  裁片实际尺寸 = 展开尺寸 + **缝份 × 边数**（梯形裁片的四条边各自加缝份），**缝份必须显式加进尺寸并标注**，不能让用户自己猜。
- **展开（放样）算法**：
  - 棱柱侧面：每面是梯形/矩形（上宽由该层直径定）；
  - 旋转体：按母线等分（默认 24 等分）展开成扇形/梯形块，**给出的是近似展开**（制造上用足够多的小块拼接），界面必须标注「旋转体按 24 等分近似展开，等分数可调」；
  - 顶/底盖：圆形（含折边宽度）。
- **1:1 打印与分页**：按实际毫米绘制；分页时**一块裁片不允许跨页**（断言）；跨页仅发生在骨架长条图上，且必须有拼接十字标记与页码（如「A2-3/1」）提示重叠搭接量（默认 10mm）。
- **绑扎余量**：竖篾两端各加 `lashAllowanceMm`；横篾圈的接头处也要加（圆形圈按接头 1 处、多边形按棱数处）；构件表要同时显示 `rawLengthMm`（净长）与 `lengthMm`（含余量），**备料按含余量长度**（断言：Σ备料长度 ≥ Σ净长）。
- **面积核对**：`Σ裁片面积（不含缝份）≈ 灯体表面积`，误差 ≤ 3%（旋转体近似展开会有偏差，用例给容差）；超出容差要提示等分数不足。
- **单位**：全 mm（1 位小数）；蒙面面积用 m²（3 位小数）。
- **性能**：24 等分 × 8 层放样 < 100ms。

## 9. 交互与视觉要点
- 灯体预览用正视 + 俯视 + 骨架网格（不做 3D 渲染，但可用等轴测示意）；参数一改即时更新。
- 构件表按类别分组，竹篾长度保留 1 位小数并显示「含两端各 20mm 余量」的说明。
- 裁片图上标注：尺寸箭头、缝份虚线（明显区分实裁线）、对位标记编号。
- 放样图打印页显式提示「请关闭『适应页面』并按 100% 打印」，附 100mm 校验尺。

## 10. 验收标准
- 几何：正六棱柱、八棱柱、圆形的棱长/周长与手算一致（误差 ≤ 1mm）；竖篾长度与分段高度累计一致。
- 缝份：裁片尺寸 = 展开尺寸 + 缝份 × 边数（断言）；缝份在图上有虚线标注。
- 备料守恒：`Σ备料长度 ≥ Σ净长` 且差值等于余量总和（断言）。
- 面积核对：`Σ裁片净面积 / 灯体表面积 ∈ [0.97, 1.03]`；不满足时给出等分数建议。
- 分页：任一裁片不跨页（断言）；长条骨架图跨页有对位十字与搭接量标注。
- 1:1 打印：100mm 校验尺实测误差 ≤ 1mm；圆形底盖打印后直径误差 ≤ 1mm。
- 批量：20 个同规格灯的材料总量 = 单灯 × 20 × (1 + 损耗率)（断言）。
- 放样计算 < 100ms。

## 11. 边界（刻意不做）
不做 3D 建模与渲染（只做放样与展开）、不做在线素材商城与订单、不做灯会活动排期与票务、不做电气设计与控制（LED 只给数量建议）——核心只做**骨架放样 + 蒙面裁片 + 1:1 图纸 + 备料单**，避开黑名单中的电商订单、预约系统方向。

## 12. 容器化与构建（Docker）

- **Dockerfile（多阶段）**：`node:20-alpine` 构建 → `nginx:1.27-alpine` 只拷 `dist/` 与 `nginx.conf`
- **docker-compose.yml**：服务名 `app-032`，端口 **`8112:80`**，`restart: unless-stopped`；`HEALTHCHECK` 请求 `/healthz`
- **nginx.conf**：SPA 回退；哈希资源 `immutable`；`index.html` no-cache；gzip；**SVG 正确 MIME**
- 无后端依赖，断网可用；灯型库与工艺参数本地打包
- 导出 PDF 走浏览器打印（1:1 依赖用户关闭缩放，页面必须给出提示与校验尺）

```bash
cd frontend/app-032
docker compose up -d --build
curl http://localhost:8112/healthz
docker compose down
```

- **验收**：`http://localhost:8112` 完成「选灯型 → 填尺寸 → 看骨架件表 → 出裁片 → 1:1 打印」；镜像 < 60MB。

### 忽略文件（.dockerignore / .gitignore）

- **`.dockerignore`**：`node_modules`、`dist`、`.git`、`.gitignore`、`.env`、`.env.*`、`*.log`、`coverage`、`.vscode`、`.idea`、`Dockerfile`、`nginx.conf`、`README.md`
  - `node_modules` 必须排除；**保留** `package-lock.json`、`src/data/lantern-types.json`（灯型与工艺参数）
- **`.gitignore`**：`node_modules/`、`dist/`、`.env*`、`*.log`、`coverage/`、`.DS_Store`、`.vscode/`、`.idea/`，另排**客户灯样照片与放样输出** `clients/`、`photos/`、`exports/`、`*.pdf`
- **自检**：构建上下文 < 5MB；`git status` 不出现客户灯样与放样图纸
