<template>
  <div id="analysis">
    <div ref="container" id="container"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { init } from './index'

const container = ref<HTMLDivElement>()

onMounted(() => {
  init(container.value!)
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
