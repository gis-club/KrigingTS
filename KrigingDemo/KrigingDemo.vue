<template>
  <div id="analysis">
    <div ref="container" id="container"></div>
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import * as Cesium from 'cesium'
import { init } from './index'

const container = ref<HTMLDivElement>()

let viewer: Cesium.Viewer

onMounted(() => {
  viewer = init(container.value as HTMLDivElement)
})
</script>
<style lang="scss" scoped>
#analysis {
  position: relative;
  width: 100%;
  height: 100%;

  #container {
    width: 100%;
    height: 100%;
  }
}
</style>
