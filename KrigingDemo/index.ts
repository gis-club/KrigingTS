import * as Cesium from 'cesium'
import KrigingClass from '../kriging'
import axios from 'axios'
import GUI from 'lil-gui'

const colors = [
  { min: 0, max: 0.1, color: '#FFFFFF' },
  { min: 0.2, max: 10, color: '#A7F290' },
  { min: 11, max: 25, color: '#3CBB3C' },
  { min: 26, max: 50, color: '#61B8FF' },
  { min: 51, max: 100, color: '#0000E1' },
  { min: 101, max: 150, color: '#FA01FA' },
  { min: 151, max: 250, color: '#800040' },
  { min: 251, max: 999, color: '#3F001C' }
]

export const init = async (element: HTMLDivElement) => {
  const viewer = new Cesium.Viewer(element, {
    baseLayer: Cesium.ImageryLayer.fromProviderAsync(
      Cesium.TileMapServiceImageryProvider.fromUrl(
        Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')
      )
    ),
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    vrButton: false,
    scene3DOnly: true,
    infoBox: false
  })

  const kriging = new KrigingClass()

  const { data: pointData } = await axios.get(
    `${import.meta.env.BASE_URL}cezhan.json`
  )
  const lngs: number[] = []
  const lats: number[] = []
  const siteValue: number[] = []
  pointData.features.forEach((item: any) => {
    siteValue.push(item.attributes['2015年'])
    lngs.push(item.geometry.x)
    lats.push(item.geometry.y)
  })

  const { data: areaData } = await axios.get(
    `${import.meta.env.BASE_URL}tianjin_line_1.json`
  )
  const coords: number[] = []
  areaData.features[0].geometry.coordinates.forEach((item: any) => {
    coords.push(item[0])
    coords.push(item[1])
  })
  const ex = [areaData.features[0].geometry.coordinates]

  const extent = Cesium.PolygonGeometry.computeRectangleFromPositions(
    Cesium.Cartesian3.fromDegreesArray(coords)
  )
  const minx = Cesium.Math.toDegrees(extent.west)
  const miny = Cesium.Math.toDegrees(extent.south)
  const maxx = Cesium.Math.toDegrees(extent.east)
  const maxy = Cesium.Math.toDegrees(extent.north)

  const variogram = kriging.train(siteValue, lngs, lats, 'spherical', 0, 200)
  const gridWidth = (maxy - miny) / 1000

  // 添加站点标记
  lats.forEach((lat, index) => {
    viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lngs[index], lat),
      point: { pixelSize: 8, color: Cesium.Color.RED }
    })
  })

  // 持久 canvas，避免重复创建
  const surfaceCanvas = document.createElement('canvas')
  surfaceCanvas.width = 2000
  surfaceCanvas.height = 2000

  // 先创建一个固定的 entity，后续只更新材质
  const imageProp = new Cesium.ImageMaterialProperty({
    image: surfaceCanvas,
    transparent: true,
    color: Cesium.Color.WHITE.withAlpha(0.7)
  })

  const rainEntity = viewer.entities.add({
    id: 'KrigingRain',
    polygon: {
      show: true,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      hierarchy: {
        positions: Cesium.Cartesian3.fromDegreesArray(coords)
      } as any,
      material: imageProp
    }
  })

  function renderIsosurface(mode: 'grid' | 'rasterGrid') {
    const t0 = performance.now()
    const grid = mode === 'rasterGrid'
      ? kriging.rasterGrid(ex, variogram, gridWidth)
      : kriging.grid(ex, variogram, gridWidth)
    const gridMs = performance.now() - t0

    if (grid) {
      const tp = performance.now()
      kriging.plot(surfaceCanvas, grid, [minx, maxx], [miny, maxy], colors)
      const plotMs = performance.now() - tp

      // 通知 Cesium 贴图已更新
      imageProp.image = new Cesium.ConstantProperty(surfaceCanvas)

      return { gridMs: Math.round(gridMs), plotMs: Math.round(plotMs) }
    }
    return { gridMs: 0, plotMs: 0 }
  }

  // 首次渲染
  const initial = renderIsosurface('grid')
  viewer.flyTo(rainEntity)

  // GUI 控制面板
  const params = {
    method: 'grid' as 'grid' | 'rasterGrid',
    gridTime: `${initial.gridMs} ms`,
    plotTime: `${initial.plotMs} ms`,
    render: () => {
      const result = renderIsosurface(params.method)
      params.gridTime = `${result.gridMs} ms`
      params.plotTime = `${result.plotMs} ms`
      gridTimeCtrl.updateDisplay()
      plotTimeCtrl.updateDisplay()
    }
  }

  const gui = new GUI({ title: 'Kriging 控制面板' })
  gui.add(params, 'method', { '标准 grid（射线法）': 'grid', '加速 rasterGrid（位图法）': 'rasterGrid' })
    .name('渲染方式')
  gui.add(params, 'render').name('▶ 重新渲染')
  const gridTimeCtrl = gui.add(params, 'gridTime').name('Grid 耗时').disable()
  const plotTimeCtrl = gui.add(params, 'plotTime').name('Plot 耗时').disable()

  return viewer
}
