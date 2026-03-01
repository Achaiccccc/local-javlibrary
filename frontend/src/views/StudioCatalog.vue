<template>
  <div class="studio-list">
    <el-container>
      <el-header>
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
          <h1 style="margin: 0;">制作商列表</h1>
        </div>
      </el-header>
      <el-main>
        <el-card>
          <div v-if="loading">加载中...</div>
          <div v-else-if="studios.length === 0" class="empty-state">
            <el-empty description="暂无制作商数据，请先扫描数据文件夹" />
          </div>
          <div v-else class="studios-grid">
            <el-card
              v-for="studio in filteredStudios"
              :key="studio.id"
              class="studio-card"
              shadow="hover"
              @click="goToStudioDetail(studio.id)"
            >
              <div class="studio-info">
                <div class="studio-name">{{ studio.name }}</div>
                <div class="studio-meta">
                  (<span :class="{ 'playable-count': studio.playableCount > 0 }">{{ studio.playableCount }}</span>/{{ studio.totalCount }})
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
defineOptions({ name: 'StudioCatalog' });
import { ref, onMounted, onActivated, computed } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useScanStore } from '../stores/scanStore';

const router = useRouter();
const scanStore = useScanStore();
const lastRefreshedDataVersion = ref(0);
const loading = ref(true);
const studios = ref([]);
const filterPlayable = ref(false);

const loadStudios = async () => {
  try {
    loading.value = true;
    const result = await window.electronAPI.studios.getList();
    if (result.success) {
      studios.value = result.data || [];
      lastRefreshedDataVersion.value = scanStore.dataVersion;
    } else {
      ElMessage.error('加载制作商列表失败: ' + (result.message || '未知错误'));
    }
  } catch (error) {
    console.error('加载制作商列表失败:', error);
    ElMessage.error('加载制作商列表失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

const goToStudioDetail = (studioId) => {
  router.push(`/studio/${studioId}`);
};

const filteredStudios = computed(() => {
  if (!filterPlayable.value) {
    return studios.value;
  }
  // 仅显示有可播放影片的制作商
  return studios.value.filter(studio => studio.playableCount > 0);
});

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
    loadStudios();
  }
});

onMounted(() => {
  loadFilterPlayable();
  loadStudios();
  if (window.electronAPI?.system?.onFileChange) {
    window.electronAPI.system.onFileChange((data) => {
      console.log('文件变化:', data);
      loadStudios();
    });
  }
  
  if (window.electronAPI?.system?.onDatabaseReady) {
    window.electronAPI.system.onDatabaseReady(() => {
      console.log('数据库已就绪，重新加载数据');
      loadStudios();
    });
  }
  
  if (window.electronAPI?.system?.onScanCompleted) {
    window.electronAPI.system.onScanCompleted((result) => {
      console.log('扫描完成:', result);
      loadStudios();
    });
  }
  
  window.addEventListener('filterPlayableChanged', () => {
    console.log('过滤设置已更改，重新加载过滤设置');
    loadFilterPlayable();
  });
});
</script>

<style scoped>
.studio-list {
  width: 100%;
  height: 100%;
}

.el-header {
  background-color: #409eff;
  color: white;
  display: flex;
  align-items: center;
  padding: 0 20px;
}

.empty-state {
  padding: 40px 0;
}

.studios-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 8px;
  padding: 16px 0;
}

.studio-card {
  cursor: pointer;
  transition: transform 0.2s;
}

.studio-card:hover {
  transform: translateY(-4px);
}

.studio-info {
  text-align: center;
  padding: 4px;
}

.studio-name {
  font-size: 12px;
  font-weight: bold;
  margin-bottom: 2px;
  color: #303133;
}

.studio-meta {
  font-size: 10px;
  color: #909399;
}

.playable-count {
  color: #67c23a;
  font-weight: bold;
}
</style>
