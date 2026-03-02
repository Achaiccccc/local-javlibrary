<template>
  <div class="theme-switch-wrap">
    <el-switch
      :model-value="isDark"
      inline-prompt
      :inactive-icon="MoonIcon"
      :active-icon="SunIcon"
      @update:model-value="toggle"
    />
  </div>
</template>

<script setup>
import { h, computed } from 'vue';
import { useThemeStore } from '../stores/themeStore';
import sunIcon from '../assets/icon/sun.svg';
import moonIcon from '../assets/icon/moon.svg';

const themeStore = useThemeStore();
const isDark = computed(() => themeStore.isDark);

const SunIcon = () => h('img', { src: sunIcon, class: 'theme-switch-icon', alt: '日间' });
const MoonIcon = () => h('img', { src: moonIcon, class: 'theme-switch-icon', alt: '夜间' });

function toggle(value) {
  themeStore.setTheme(value ? 'dark' : 'light');
}
</script>

<style scoped>
.theme-switch-wrap {
  display: inline-flex;
  align-items: center;
}

:deep(.theme-switch-icon) {
  width: 14px;
  height: 14px;
  vertical-align: middle;
}
</style>
