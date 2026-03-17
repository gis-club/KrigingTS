# KrigingTS

kriging.js 的 TypeScript 版本，用于空间插值计算，可配合 Cesium 实现等值面可视化。

原始 kriging.js：https://github.com/oeo4b/kriging.js

## 快速开始

```bash
npm install
npm run dev
```

访问 `http://localhost:5173/` 查看 Cesium 等值面 Demo。

## 项目结构

```
├── kriging.ts              # 克里金插值 TypeScript 实现
├── kriging_fast.js         # 克里金插值 JavaScript 实现
├── global.d.ts             # Array 扩展方法类型声明
├── KrigingDemo/            # Cesium 等值面示例
│   ├── KrigingDemo.vue     # Vue 组件
│   └── index.ts            # 初始化与插值逻辑
├── public/                 # 示例数据
│   ├── cezhan.json         # 测站点数据
│   └── tianjin_line_1.json # 区域边界数据
└── src/                    # Vue 应用入口
    ├── main.ts
    └── App.vue
```

## 使用方式

```typescript
import KrigingClass from './kriging'

const kriging = new KrigingClass()

// 1. 训练 variogram 对象
const variogram = kriging.train(siteValue, lngs, lats, 'spherical', 0, 200)

// 2. 生成格网预测值
const grid = kriging.grid(polygons, variogram, (maxy - miny) / 1000)

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
    clampToGround: true,
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

| 参数 | 类型 | 说明 |
|------|------|------|
| `siteValue` | `number[]` | 站点观测值 |
| `lngs` | `number[]` | 站点经度集合 |
| `lats` | `number[]` | 站点纬度集合 |
| `model` | `string` | 变差函数模型：`gaussian` / `exponential` / `spherical` |
| `sigma2` | `number` | 噪声方差 |
| `alpha` | `number` | 正则化参数 |
| `polygons` | `number[][][]` | 插值区域多边形坐标 |
| `width` | `number` | 格网分辨率 |
| `colors` | `{min, max, color}[]` | 色阶映射表 |

## 命令

```bash
npm run dev      # 启动开发服务器
npm run build    # 生产构建
npm run preview  # 预览构建产物
```

## GitHub Pages

推送到 `master` 分支后，GitHub Actions 会自动构建并部署到 GitHub Pages。

在线访问：https://gis-club.github.io/KrigingTS/
