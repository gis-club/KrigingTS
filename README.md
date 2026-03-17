# KrigingTS

kriging.js 的 TypeScript 版本，用于空间插值计算，可配合 Cesium 实现等值面可视化。

原始 kriging.js：https://github.com/oeo4b/kriging.js

## 快速开始

```bash
npm install
npm run dev
```

访问 `http://localhost:5173/` 查看 Cesium 等值面 Demo，通过右上角 GUI 面板切换渲染方式并对比性能。

## 项目结构

```
├── kriging.ts              # 克里金插值 TypeScript 实现（含 rasterGrid 加速方法）
├── kriging_fast.js         # 克里金插值 JavaScript 原始实现（参考）
├── global.d.ts             # Array 扩展方法类型声明
├── KrigingDemo/            # Cesium 等值面示例
│   ├── KrigingDemo.vue     # Vue 组件
│   └── index.ts            # 初始化、插值逻辑与 lil-gui 控制面板
├── public/                 # 示例数据
│   ├── cezhan.json         # 测站点数据（60 个站点）
│   └── tianjin_line_1.json # 区域边界数据
└── src/                    # Vue 应用入口
    ├── main.ts
    └── App.vue
```

## Demo 说明

Demo 使用单个 Cesium Viewer，右上角 **lil-gui** 控制面板提供：

- **渲染方式**：下拉切换 `标准 grid（射线法）` / `加速 rasterGrid（位图法）`
- **▶ 重新渲染**：点击后执行所选方式的插值计算并更新贴图
- **Grid 耗时 / Plot 耗时**：只读字段，实时显示每次渲染的性能数据

切换下拉框不会触发渲染，需手动点击"重新渲染"以避免闪烁。

## API

### train — 训练变差函数

```typescript
import KrigingClass from './kriging'

const kriging = new KrigingClass()
const variogram = kriging.train(siteValue, lngs, lats, 'spherical', 0, 200)
```

根据观测数据拟合变差函数模型，构建 Gram 矩阵并求逆，得到预测权重。

### grid — 标准网格生成（射线法 PIP）

```typescript
const grid = kriging.grid(polygons, variogram, width)
```

在多边形区域内按步长划分格网，使用**射线法**逐点判断是否在多边形内，通过的点调用 `predict()` 计算预测值。

### rasterGrid — 光栅化加速网格生成（位图法 PIP）

```typescript
const grid = kriging.rasterGrid(polygons, variogram, width)
```

与 `grid()` 逻辑一致，但将多边形**光栅化到离屏 Canvas** 上，通过像素颜色做 O(1) 的点-in-多边形查询，替代射线法的 O(v) 查询（v 为多边形顶点数）。格网点越多，加速效果越显著。

### plot — 渲染到 Canvas

```typescript
kriging.plot(canvas, grid, [minx, maxx], [miny, maxy], colors)
```

将网格预测值按色阶映射渲染到 Canvas 画布上，可作为 Cesium Entity 的贴图材质。

### 完整示例

```typescript
import KrigingClass from './kriging'

const kriging = new KrigingClass()

// 1. 训练
const variogram = kriging.train(siteValue, lngs, lats, 'spherical', 0, 200)

// 2. 生成格网（二选一）
const grid = kriging.grid(polygons, variogram, (maxy - miny) / 1000)
// const grid = kriging.rasterGrid(polygons, variogram, (maxy - miny) / 1000)

// 3. 渲染到 canvas
const canvas = document.createElement('canvas')
canvas.width = 2000
canvas.height = 2000
if (grid) {
  kriging.plot(canvas, grid, [minx, maxx], [miny, maxy], colors)
}

// 4. 贴图到 Cesium Entity
viewer.entities.add({
  id: 'KrigingRain',
  polygon: {
    show: true,
    hierarchy: {
      positions: Cesium.Cartesian3.fromDegreesArray(coords)
    },
    material: new Cesium.ImageMaterialProperty({
      image: canvas,
      transparent: true,
      color: Cesium.Color.WHITE.withAlpha(0.7)
    })
  }
})
```

### 参数说明

| 方法 | 参数 | 类型 | 说明 |
|------|------|------|------|
| `train` | `t` | `number[]` | 站点观测值 |
| | `x` | `number[]` | 站点经度 |
| | `y` | `number[]` | 站点纬度 |
| | `model` | `string` | 变差函数模型：`gaussian` / `exponential` / `spherical` |
| | `sigma2` | `number` | 噪声方差（正则化项，防止 Gram 矩阵奇异） |
| | `alpha` | `number` | 先验精度（越大越信任数据） |
| `grid` / `rasterGrid` | `polygons` | `number[][][]` | 插值区域多边形坐标 |
| | `variogram` | `VariogramClass` | `train()` 返回的变差函数对象 |
| | `width` | `number` | 格网步长（越小精度越高，计算量越大） |
| `plot` | `canvas` | `HTMLCanvasElement` | 目标画布 |
| | `grid` | `IGrid` | `grid()` 或 `rasterGrid()` 返回的网格数据 |
| | `xlim` | `number[]` | X 轴显示范围 `[min, max]` |
| | `ylim` | `number[]` | Y 轴显示范围 `[min, max]` |
| | `colors` | `{min, max, color}[]` | 色阶映射表 |

### grid vs rasterGrid

| | `grid` | `rasterGrid` |
|--|--------|--------------|
| PIP 算法 | 射线法（Ray Casting） | 位图像素查询 |
| 单次查询复杂度 | O(v)，v = 多边形顶点数 | O(1) |
| 预处理开销 | 无 | 创建离屏 Canvas + 光栅化 |
| 适用场景 | 格网点少 / 多边形简单 | 格网点多 / 多边形复杂 |

## 命令

```bash
npm run dev      # 启动开发服务器
npm run build    # 生产构建（含 TypeScript 类型检查）
npm run preview  # 预览构建产物
```

## GitHub Pages

推送到 `master` 分支后，GitHub Actions 会自动构建并部署到 GitHub Pages。

在线访问：https://gis-club.github.io/KrigingTS/
