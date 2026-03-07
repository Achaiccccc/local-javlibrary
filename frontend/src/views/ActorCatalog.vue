<template>
  <div class="catalog-list">
    <el-container>
      <el-header class="page-header">
        <div class="header-content">
          <h1 class="header-title">{{ getCurrentCatalogTitle() }}</h1>
          <div class="header-right">
            <el-select
              v-model="currentCatalog"
              style="width: 180px;"
              @change="handleCatalogChange"
              class="catalog-selector"
            >
              <el-option label="演员" value="actor-actor" />
              <el-option label="文件目录" value="actor-folder" />
              <el-option label="导演" value="director" />
              <el-option label="制作商" value="studio" />
              <el-option label="分类" value="genre" />
            </el-select>
            <ThemeSwitch />
          </div>
        </div>
      </el-header>
      <el-main class="page-theme-bg">
        <el-card>
          <div v-if="loading">加载中...</div>
          <div v-else-if="actors.length === 0" class="empty-state">
            <el-empty :description="getEmptyDescription()" />
          </div>
          <div v-else class="actors-grid">
              <el-card
                v-for="item in filteredItems"
                :key="item.id"
                class="actor-card"
                shadow="hover"
                @click="goToDetail(item)"
              >
                <div class="actor-info">
                  <div class="actor-name">{{ item.name }}</div>
                  <div class="actor-meta">
                    (<span :class="{ 'playable-count': item.playableCount > 0 }">{{ item.playableCount }}</span>/{{ item.totalCount }})
                  </div>
                </div>
              </el-card>
          </div>
        </el-card>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
defineOptions({ name: 'ActorCatalog' });
import { ref, onMounted, onActivated, computed } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useScanStore } from '../stores/scanStore';
import ThemeSwitch from '../components/ThemeSwitch.vue';

const router = useRouter();
const scanStore = useScanStore();
const lastRefreshedDataVersion = ref(0);
const loading = ref(true);
const actors = ref([]);
const filterPlayable = ref(false);

// 从 localStorage 恢复当前目录类型
const getInitialCatalog = () => {
  try {
    const stored = localStorage.getItem('javlibrary_catalog_type');
    return stored || 'actor-folder';
  } catch (error) {
    console.error('获取目录类型失败:', error);
    return 'actor-folder';
  }
};

const currentCatalog = ref(getInitialCatalog());

// 解析当前目录类型
const catalogType = computed(() => {
  const parts = currentCatalog.value.split('-');
  return {
    type: parts[0], // 'actor', 'director', 'studio', 'genre'
    mode: parts[1] || null // 'folder', 'actor' (仅用于演员)
  };
});

// 获取当前目录标题
const getCurrentCatalogTitle = () => {
  const { type, mode } = catalogType.value;
  if (type === 'actor') {
    return mode === 'folder' ? '文件目录' : '演员目录';
  } else if (type === 'director') {
    return '导演列表';
  } else if (type === 'studio') {
    return '制作商列表';
  } else if (type === 'genre') {
    return '分类列表';
  }
  return '目录';
};

const getEmptyDescription = () => {
  const { type, mode } = catalogType.value;
  if (type === 'actor') {
    return mode === 'folder' ? '暂无文件目录数据，请先扫描数据文件夹' : '暂无女优数据，请先扫描数据文件夹';
  } else if (type === 'director') {
    return '暂无导演数据，请先扫描数据文件夹';
  } else if (type === 'studio') {
    return '暂无制作商数据，请先扫描数据文件夹';
  } else if (type === 'genre') {
    return '暂无分类数据，请先扫描数据文件夹';
  }
  return '暂无数据';
};

const loadCatalog = async () => {
  try {
    loading.value = true;
    const { type, mode } = catalogType.value;
    let result;

    if (type === 'actor') {
      result = await window.electronAPI.actors.getList({ viewMode: mode });
    } else if (type === 'director') {
      result = await window.electronAPI.directors.getList();
    } else if (type === 'studio') {
      result = await window.electronAPI.studios.getList();
    } else if (type === 'genre') {
      result = await window.electronAPI.genres.getList();
    } else {
      ElMessage.error('未知的目录类型');
      return;
    }

    if (result.success) {
      actors.value = result.data || [];
      lastRefreshedDataVersion.value = scanStore.dataVersion;
    } else {
      ElMessage.error('加载列表失败: ' + (result.message || '未知错误'));
    }
  } catch (error) {
    console.error('加载列表失败:', error);
    ElMessage.error('加载列表失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

const handleCatalogChange = () => {
  // 保存当前目录类型到 localStorage
  try {
    localStorage.setItem('javlibrary_catalog_type', currentCatalog.value);
  } catch (error) {
    console.error('保存目录类型失败:', error);
  }
  loadCatalog();
};

const goToDetail = (item) => {
  const itemId = typeof item === 'object' ? item.id : item;
  if (!itemId || itemId === 'N/A' || itemId === null || itemId === undefined) {
    ElMessage.warning('无效的ID');
    return;
  }

  const { type, mode } = catalogType.value;

  if (type === 'actor') {
    if (mode === 'folder') {
      // 文件目录模式：若该文件夹下仅一部影片，直接进入详情页；否则进入列表页
      if (item.totalCount === 1 && item.movieId) {
        router.push(`/movie/${item.movieId}`);
        return;
      }
      const folderName = typeof itemId === 'string' && itemId.startsWith('folder_')
        ? itemId.replace('folder_', '')
        : itemId;
      router.push(`/actor/${encodeURIComponent(folderName)}?viewMode=folder`);
    } else {
      // 女优目录模式：id是数字
      const id = parseInt(itemId);
      if (isNaN(id)) {
        console.error('无法转换为数字的ID:', itemId);
        ElMessage.warning('无效的ID: ' + itemId);
        return;
      }
      router.push(`/actor/${id}?viewMode=actor`);
    }
  } else if (type === 'director') {
    router.push(`/director/${itemId}`);
  } else if (type === 'studio') {
    router.push(`/studio/${itemId}`);
  } else if (type === 'genre') {
    router.push(`/genre/${itemId}`);
  }
};

// 根据设置过滤项目
const filteredItems = computed(() => {
  if (!filterPlayable.value) {
    return actors.value;
  }
  // 仅显示有可播放影片的项目
  return actors.value.filter(item => item.playableCount > 0);
});

// 加载过滤设置
const loadFilterPlayable = async () => {
  try {
    const value = await window.electronAPI.settings.getFilterPlayable();
    filterPlayable.value = value || false;
  } catch (error) {
    console.error('加载过滤设置失败:', error);
  }
};

onActivated(() => {
  if (scanStore.dataVersion > lastRefreshedDataVersion.value) {
    lastRefreshedDataVersion.value = scanStore.dataVersion;
    loadCatalog();
  }
});

onMounted(() => {
  loadFilterPlayable();
  loadCatalog();
  if (window.electronAPI?.system?.onFileChange) {
    window.electronAPI.system.onFileChange((data) => {
      console.log('文件变化:', data);
      // 重新加载列表
      loadCatalog();
    });
  }
  
  // 监听数据库就绪事件
  if (window.electronAPI?.system?.onDatabaseReady) {
    window.electronAPI.system.onDatabaseReady(() => {
      console.log('数据库已就绪，重新加载数据');
      loadCatalog();
    });
  }
  
  // 监听扫描完成事件
  if (window.electronAPI?.system?.onScanCompleted) {
    window.electronAPI.system.onScanCompleted((result) => {
      console.log('扫描完成:', result);
      // 重新加载列表
      loadCatalog();
    });
  }
  
  // 监听过滤设置变化事件
  window.addEventListener('filterPlayableChanged', () => {
    console.log('过滤设置已更改，重新加载过滤设置');
    loadFilterPlayable();
  });
});
</script>

<style scoped>
.catalog-list {
  width: 100%;
  height: 100%;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.header-title { margin: 0; }
.header-right { display: flex; align-items: center; gap: 12px; }
.page-header {
  background-color: var(--header-bg);
  color: var(--title-color);
  display: flex;
  align-items: center;
  padding: 0 20px;
}

.empty-state {
  padding: 40px 0;
}

.actors-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 8px;
  padding: 16px 0;
}

.actor-card {
  cursor: pointer;
  transition: transform 0.2s;
}

.actor-card:hover {
  transform: translateY(-4px);
}

.actor-info {
  text-align: center;
  padding: 4px;
}

.actor-name {
  font-size: 12px;
  font-weight: bold;
  margin-bottom: 2px;
  color: var(--content-title-color);
}

.actor-meta {
  font-size: 10px;
  color: var(--content-subtitle-color);
}

.playable-count {
  color: #67c23a;
  font-weight: bold;
}

/* 当可播放条数为0时，不应用绿色样式 */
.actor-meta span:not(.playable-count) {
  color: inherit;
  font-weight: normal;
}

/* 日间头部下拉框：白字、半透明背景；夜间由 Element 暗色主题接管 */
[data-theme="light"] :deep(.catalog-selector) {
  color: white;
}
[data-theme="light"] :deep(.catalog-selector .el-input__wrapper) {
  background-color: rgba(255, 255, 255, 0.2);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3) inset;
}
[data-theme="light"] :deep(.catalog-selector .el-input__inner),
[data-theme="light"] :deep(.catalog-selector .el-input__wrapper) {
  color: white;
}
[data-theme="light"] :deep(.catalog-selector .el-select__caret) {
  color: white;
}
</style>
