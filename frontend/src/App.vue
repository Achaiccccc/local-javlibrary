<template>
  <div id="app">
    <!-- 导航栏 -->
    <div class="menu-container" :class="{ 'menu-hidden': !menuVisible }">
      <el-menu
        mode="horizontal"
        :default-active="activeMenu"
        router
        class="main-menu"
      >
        <el-menu-item index="/">
          <span>首页</span>
        </el-menu-item>
        <el-menu-item index="/actors">
          <span>目录</span>
        </el-menu-item>
        <el-menu-item index="/genres">
          <span>分类</span>
        </el-menu-item>
        <el-menu-item index="/search">
          <span>搜索</span>
        </el-menu-item>
        <el-menu-item index="/settings">
          <span>设置</span>
        </el-menu-item>
        <el-menu-item index="/about">
          <span>关于</span>
        </el-menu-item>
      </el-menu>
    </div>
    <div class="router-view-container">
      <router-view v-slot="{ Component, route: r }">
        <keep-alive :max="10" :include="cachedViewNames">
          <component :is="Component" :key="r.fullPath" />
        </keep-alive>
      </router-view>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRoute } from 'vue-router';
import { pauseBackgroundLoading, resumeBackgroundLoading } from './utils/imageLoader';
import { useScanStore } from './stores/scanStore';

const route = useRoute();
const scanStore = useScanStore();
const activeMenu = computed(() => route.path);

const cachedViewNames = ['MovieListPage', 'Search', 'ActorCatalog', 'GenreCatalog', 'StudioCatalog', 'DirectorCatalog'];

const menuVisible = ref(true);
let lastScrollTop = 0;
const scrollThreshold = 10; // 滚动阈值，避免微小滚动触发

const handleScroll = () => {
  const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
  
  // 如果滚动距离很小，不改变菜单状态
  if (Math.abs(currentScrollTop - lastScrollTop) < scrollThreshold) {
    return;
  }
  
  // 向下滚动：隐藏菜单
  if (currentScrollTop > lastScrollTop && currentScrollTop > 50) {
    menuVisible.value = false;
  } 
  // 向上滚动：显示菜单
  else if (currentScrollTop < lastScrollTop) {
    menuVisible.value = true;
  }
  
  lastScrollTop = currentScrollTop <= 0 ? 0 : currentScrollTop;
};

// 监听路由变化，在切换页面时暂停后台加载
watch(() => route.path, (newPath, oldPath) => {
  if (oldPath && newPath !== oldPath) {
    // 路由切换时暂停后台加载
    pauseBackgroundLoading();
    // 延迟恢复，让新页面有时间加载数据
    setTimeout(() => {
      resumeBackgroundLoading();
    }, 500);
  }
});

onMounted(() => {
  window.addEventListener('scroll', handleScroll, { passive: true });
  lastScrollTop = window.pageYOffset || document.documentElement.scrollTop;
  resumeBackgroundLoading();
  if (window.electronAPI?.system?.onFileChange) {
    window.electronAPI.system.onFileChange((data) => {
      if (data?.type === 'startup_sync_done') scanStore.incrementDataVersion();
    });
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('scroll', handleScroll);
});
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#app {
  width: 100%;
  height: 100vh;
}

.menu-container {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  background-color: #fff;
  transition: transform 0.3s ease-in-out;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.menu-container.menu-hidden {
  transform: translateY(-100%);
}

.main-menu {
  border-bottom: 1px solid #e6e6e6;
}

/* 为所有页面容器添加顶部margin，避免被固定菜单遮挡 */
/* :deep(.el-container) {
  margin-top: 60px;
} */
.router-view-container{
  padding-top: 60px;
  height: calc(100% - 60px);
}

/* 或者为所有页面容器添加顶部margin */
/* .el-container {
  margin-top: 60px;
} */
</style>
