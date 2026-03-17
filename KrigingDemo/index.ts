import * as Cesium from 'cesium'
import KrigingClass from '../kriging'
import axios from 'axios'

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

export const init = (elemnet: HTMLDivElement) => {
  const viewer = new Cesium.Viewer(elemnet, {
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

  isosurfaces(viewer)

  return viewer
}

async function isosurfaces(viewer: Cesium.Viewer) {
  const kriging = new KrigingClass()

  // 加载测站点数据
  const { data: pointData } = await axios.get(
    `${import.meta.env.VITE_BASE_URL}/cezhan.json`
  )

  const lngs: number[] = []
  const lats: number[] = []
  const siteValue: number[] = []

  pointData.features.forEach((item: any) => {
    siteValue.push(item.attributes['2015年'])
    lngs.push(item.geometry.x)
    lats.push(item.geometry.y)
  })

  // 加载区域边界数据
  const { data: areaData } = await axios.get(
    `${import.meta.env.VITE_BASE_URL}/tianjin_line_1.json`
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

  // 1.用克里金训练一个variogram对象
  const variogram = kriging.train(siteValue, lngs, lats, 'spherical', 0, 200)
  // 2.使用刚才的variogram对象使polygons描述的地理位置内的格网元素具备不一样的预测值
  const grid = kriging.grid(ex, variogram, (maxy - miny) / 1000)

  const canvas = document.createElement('canvas')
  canvas.width = 2000
  canvas.height = 2000
  canvas.style.display = 'block'

  // 3.将得到的格网预测值渲染到canvas画布上
  if (grid) {
    kriging.plot(canvas, grid, [minx, maxx], [miny, maxy], colors)
  }

  // 4.使用贴图的方式将结果贴到面上
  const entity = viewer.entities.add({
    id: 'KrigingRain',
    polygon: {
      show: true,
      clampToGround: true,
      hierarchy: {
        positions: Cesium.Cartesian3.fromDegreesArray(coords)
      } as any,
      material: new Cesium.ImageMaterialProperty({
        image: canvas,
        transparent: true,
        color: Cesium.Color.WHITE.withAlpha(0.7)
      })
    }
  })

  // 添加测站点标记
  lats.forEach((lat, index) => {
    viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lngs[index], lat),
      point: {
        pixelSize: 8,
        color: Cesium.Color.RED
      }
    })
  })

  viewer.flyTo(entity)
}
