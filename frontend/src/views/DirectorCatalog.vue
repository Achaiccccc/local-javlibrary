<template>
  <div class="director-list">
    <el-container>
      <el-header>
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
          <h1 style="margin: 0;">导演列表</h1>
        </div>
      </el-header>
      <el-main>
        <el-card>
          <div v-if="loading">加载中...</div>
          <div v-else-if="directors.length === 0" class="empty-state">
            <el-empty description="暂无导演数据，请先扫描数据文件夹" />
          </div>
          <div v-else class="directors-grid">
            <el-card
              v-for="director in filteredDirectors"
              :key="director.id"
              class="director-card"
              shadow="hover"
              @click="goToDirectorDetail(director.id)"
            >
              <div class="director-info">
                <div class="director-name">{{ director.name }}</div>
                <div class="director-meta">
                  (<span :class="{ 'playable-count': director.playableCount > 0 }">{{ director.playableCount }}</span>/{{ director.totalCount }})
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
defineOptions({ name: 'DirectorCatalog' });
import { ref, onMounted, onActivated, computed } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useScanStore } from '../stores/scanStore';

const router = useRouter();
const scanStore = useScanStore();
const lastRefreshedDataVersion = ref(0);
const loading = ref(true);
const directors = ref([]);
const filterPlayable = ref(false);

const loadDirectors = async () => {
  try {
    loading.value = true;
    const result = await window.electronAPI.directors.getList();
    if (result.success) {
      directors.value = result.data || [];
      lastRefreshedDataVersion.value = scanStore.dataVersion;
    } else {
      ElMessage.error('加载导演列表失败: ' + (result.message || '未知错误'));
    }
  } catch (error) {
    console.error('加载导演列表失败:', error);
    ElMessage.error('加载导演列表失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

const goToDirectorDetail = (directorId) => {
  router.push(`/director/${directorId}`);
};

const filteredDirectors = computed(() => {
  if (!filterPlayable.value) {
    return directors.value;
  }
  // 仅显示有可播放影片的导演
  return directors.value.filter(director => director.playableCount > 0);
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
    loadDirectors();
  }
});

onMounted(() => {
  loadFilterPlayable();
  loadDirectors();
  if (window.electronAPI?.system?.onFileChange) {
    window.electronAPI.system.onFileChange((data) => {
      console.log('文件变化:', data);
      loadDirectors();
    });
  }
  
  if (window.electronAPI?.system?.onDatabaseReady) {
    window.electronAPI.system.onDatabaseReady(() => {
      console.log('数据库已就绪，重新加载数据');
      loadDirectors();
    });
  }
  
  if (window.electronAPI?.system?.onScanCompleted) {
    window.electronAPI.system.onScanCompleted((result) => {
      console.log('扫描完成:', result);
      loadDirectors();
    });
  }
  
  window.addEventListener('filterPlayableChanged', () => {
    console.log('过滤设置已更改，重新加载过滤设置');
    loadFilterPlayable();
  });
});
</script>

<style scoped>
.director-list {
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

.directors-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 8px;
  padding: 16px 0;
}

.director-card {
  cursor: pointer;
  transition: transform 0.2s;
}

.director-card:hover {
  transform: translateY(-4px);
}

.director-info {
  text-align: center;
  padding: 4px;
}

.director-name {
  font-size: 12px;
  font-weight: bold;
  margin-bottom: 2px;
  color: #303133;
}

.director-meta {
  font-size: 10px;
  color: #909399;
}

.playable-count {
  color: #67c23a;
  font-weight: bold;
}
</style>
