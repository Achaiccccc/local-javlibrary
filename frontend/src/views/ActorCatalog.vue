<template>
  <div class="catalog-list">
    <el-container>
      <el-header class="page-header">
        <div class="header-content">
          <h1 class="header-title">{{ getCurrentCatalogTitle() }}</h1>
          <div class="header-right">
            <template v-if="catalogType.type === 'actor' && catalogType.mode === 'actor'">
              <el-button
                type="default"
                :icon="ZoomOut"
                circle
                class="grid-zoom-btn"
                title="缩小图片"
                @click="gridZoomOut"
              />
              <el-button
                type="default"
                :icon="ZoomIn"
                circle
                class="grid-zoom-btn"
                title="放大图片"
                @click="gridZoomIn"
              />
            </template>
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
          <div v-else class="actors-grid" :class="`grid-${gridSize}`">
              <el-card
                v-for="item in filteredItems"
                :key="item.id"
                class="actor-card"
                shadow="hover"
                @click="goToDetail(item)"
              >
                <div class="actor-card-inner">
                  <div class="actor-info">
                    <template v-if="catalogType.type === 'actor' && catalogType.mode === 'actor' && item.avatar?.hasAvatar">
                      <div class="actor-avatar-wrap">
                        <el-image
                          :src="item.avatar.url"
                          fit="cover"
                          class="actor-avatar-image"
                        >
                          <template #error>
                            <div class="actor-avatar-slot">加载失败</div>
                          </template>
                        </el-image>
                      </div>
                    </template>
                    <div class="actor-name">{{ item.name }}</div>
                    <div class="actor-meta">
                      (<span :class="{ 'playable-count': item.playableCount > 0 }">{{ item.playableCount }}</span>/{{ item.totalCount }})
                    </div>
                  </div>
                  <el-icon
                    v-if="catalogType.type === 'actor' && catalogType.mode === 'actor' && item.avatar?.hasMultiple"
                    class="actor-card-edit-icon"
                    @click.stop="openAvatarPicker(item.name)"
                  >
                    <Edit />
                  </el-icon>
                </div>
              </el-card>
          </div>
        </el-card>
        <ActorAvatarPickerDialog
          v-model="avatarPickerVisible"
          :actor-name="avatarPickerActorName"
          @done="onAvatarPickerDone"
        />
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
defineOptions({ name: 'ActorCatalog' });
import { ref, onMounted, onActivated, onBeforeUnmount, computed, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Edit, ZoomIn, ZoomOut } from '@element-plus/icons-vue';
import { useScanStore } from '../stores/scanStore';
import ThemeSwitch from '../components/ThemeSwitch.vue';
import ActorAvatarPickerDialog from '../components/ActorAvatarPickerDialog.vue';

const router = useRouter();
const route = useRoute();
const scanStore = useScanStore();
const lastRefreshedDataVersion = ref(0);
const loading = ref(true);
const actors = ref([]);
const filterPlayable = ref(false);
const avatarPickerVisible = ref(false);
const avatarPickerActorName = ref('');
const GRID_SIZES = ['small', 'medium', 'large', 'xlarge', 'xxlarge'];
const GRID_SIZE_KEY = 'javlibrary_actor_grid_size';
const getInitialGridSize = () => {
  try {
    const stored = localStorage.getItem(GRID_SIZE_KEY);
    return GRID_SIZES.includes(stored) ? stored : 'medium';
  } catch (_) {
    return 'medium';
  }
};
const gridSize = ref(getInitialGridSize());

function gridZoomIn() {
  const i = GRID_SIZES.indexOf(gridSize.value);
  if (i < GRID_SIZES.length - 1) gridSize.value = GRID_SIZES[i + 1];
  try {
    localStorage.setItem(GRID_SIZE_KEY, gridSize.value);
  } catch (_) {}
}

function gridZoomOut() {
  const i = GRID_SIZES.indexOf(gridSize.value);
  if (i > 0) gridSize.value = GRID_SIZES[i - 1];
  try {
    localStorage.setItem(GRID_SIZE_KEY, gridSize.value);
  } catch (_) {}
}

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

function openAvatarPicker(name) {
  avatarPickerActorName.value = name || '';
  avatarPickerVisible.value = true;
}

async function onAvatarPickerDone() {
  const name = avatarPickerActorName.value;
  if (!name) return;
  try {
    const res = await window.electronAPI?.actorAvatars?.getSummaryByName?.(name);
    if (res?.success && res?.data) {
      const item = actors.value.find(a => a.name === name);
      if (item) item.avatar = res.data;
    }
  } catch (_) {}
}

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

function onActorProfileChanged() {
  const { type } = catalogType.value;
  if (type === 'actor') {
    loadCatalog();
  }
}

onMounted(() => {
  loadFilterPlayable();
  loadCatalog();

  window.addEventListener('actorAvatarChanged', () => {
    const { type, mode } = catalogType.value;
    if (type === 'actor' && mode === 'actor') {
      loadCatalog();
    }
  });

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

  try {
    window.addEventListener('actorProfileChanged', onActorProfileChanged);
  } catch (_) {}
});

onBeforeUnmount(() => {
  try {
    window.removeEventListener('actorProfileChanged', onActorProfileChanged);
  } catch (_) {}
});

watch(
  () => route.fullPath,
  () => {
    avatarPickerVisible.value = false;
  }
);
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
  gap: 8px;
  padding: 16px 0;
}
.actors-grid.grid-small {
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
}
.actors-grid.grid-medium {
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
}
.actors-grid.grid-large {
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
}
.actors-grid.grid-xlarge {
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
}
.actors-grid.grid-xxlarge {
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}

.actor-card {
  cursor: pointer;
  transition: transform 0.2s;
  position: relative;
}

.actor-card:hover {
  transform: translateY(-4px);
}

.actor-info {
  text-align: center;
  padding: 4px;
}

.actor-avatar-wrap {
  position: relative;
  margin: 0 auto 6px;
  width: 80px;
  height: 80px;
}
.actors-grid.grid-small .actor-avatar-wrap {
  width: 56px;
  height: 56px;
  margin-bottom: 4px;
}
.actors-grid.grid-large .actor-avatar-wrap {
  width: 104px;
  height: 104px;
  margin-bottom: 8px;
}
.actors-grid.grid-xlarge .actor-avatar-wrap {
  width: 128px;
  height: 128px;
  margin-bottom: 10px;
}
.actors-grid.grid-xxlarge .actor-avatar-wrap {
  width: 160px;
  height: 160px;
  margin-bottom: 12px;
}

.actor-avatar-image {
  width: 80px;
  height: 80px;
  border-radius: 8px;
  display: block;
  background: var(--el-fill-color-light);
}
.actors-grid.grid-small .actor-avatar-image {
  width: 56px;
  height: 56px;
  border-radius: 6px;
}
.actors-grid.grid-large .actor-avatar-image {
  width: 104px;
  height: 104px;
  border-radius: 10px;
}
.actors-grid.grid-xlarge .actor-avatar-image {
  width: 128px;
  height: 128px;
  border-radius: 12px;
}
.actors-grid.grid-xxlarge .actor-avatar-image {
  width: 160px;
  height: 160px;
  border-radius: 14px;
}

.actor-avatar-slot {
  width: 80px;
  height: 80px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  background: var(--el-fill-color-light);
}
.actors-grid.grid-small .actor-avatar-slot {
  width: 56px;
  height: 56px;
  border-radius: 6px;
  font-size: 10px;
}
.actors-grid.grid-large .actor-avatar-slot {
  width: 104px;
  height: 104px;
  border-radius: 10px;
  font-size: 12px;
}
.actors-grid.grid-xlarge .actor-avatar-slot {
  width: 128px;
  height: 128px;
  border-radius: 12px;
  font-size: 13px;
}
.actors-grid.grid-xxlarge .actor-avatar-slot {
  width: 160px;
  height: 160px;
  border-radius: 14px;
  font-size: 14px;
}

.actor-card-edit-icon {
  position: absolute;
  bottom: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  padding: 2px;
  border-radius: 4px;
  background: var(--el-bg-color);
  color: var(--el-color-primary);
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

:deep(.actor-card .el-card__body) {
  padding: 5px 0;
}

.actor-name {
  font-size: 12px;
  font-weight: bold;
  margin-bottom: 2px;
  color: var(--content-title-color);
}
.actors-grid.grid-small .actor-name { font-size: 11px; }
.actors-grid.grid-large .actor-name { font-size: 13px; }
.actors-grid.grid-xlarge .actor-name { font-size: 14px; }
.actors-grid.grid-xxlarge .actor-name { font-size: 15px; }

.actor-meta {
  font-size: 10px;
  color: var(--content-subtitle-color);
}
.actors-grid.grid-small .actor-meta { font-size: 9px; }
.actors-grid.grid-large .actor-meta { font-size: 11px; }
.actors-grid.grid-xlarge .actor-meta { font-size: 12px; }
.actors-grid.grid-xxlarge .actor-meta { font-size: 13px; }

.playable-count {
  color: #67c23a;
  font-weight: bold;
}

/* 当可播放条数为0时，不应用绿色样式 */
.actor-meta span:not(.playable-count) {
  color: inherit;
  font-weight: normal;
}

/* 日间头部：放大/缩小按钮与下拉框统一白字、半透明 */
[data-theme="light"] .grid-zoom-btn {
  color: white;
  background-color: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.3);
}
[data-theme="light"] .grid-zoom-btn:hover {
  background-color: rgba(255, 255, 255, 0.35);
  border-color: rgba(255, 255, 255, 0.5);
  color: white;
}
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
