<template>
  <div class="genre-list">
    <el-container>
      <el-header>
        <div class="header-content">
          <el-button @click="goBack" icon="ArrowLeft">返回</el-button>
          <h1 style="margin: 0; margin-left: 16px;">分类列表</h1>
        </div>
      </el-header>
      <el-main>
        <el-card>
          <div v-if="loading">加载中...</div>
          <div v-else class="genres-container">
            <div
              v-for="category in groupedGenres"
              :key="category.name"
              class="category-section"
            >
              <h2 class="category-title">{{ category.name }}</h2>
              <div class="genres-grid">
                <el-card
                  v-for="genre in category.genres"
                  :key="genre.name"
                  class="genre-card"
                  :class="{ 'genre-disabled': !genre.inDatabase }"
                  :shadow="genre.inDatabase ? 'hover' : 'never'"
                  @click="genre.inDatabase && goToGenreDetail(genre.id, genre.name)"
                >
                  <div class="genre-info">
                    <div class="genre-name" :class="{ 'genre-name-disabled': !genre.inDatabase }">
                      {{ genre.name }}
                    </div>
                    <div v-if="genre.inDatabase" class="genre-meta">
                      (<span :class="{ 'playable-count': genre.playableCount > 0 }">{{ genre.playableCount }}</span>/{{ genre.totalCount }})
                    </div>
                    <div v-else class="genre-meta genre-meta-disabled">暂无数据</div>
                  </div>
                </el-card>
              </div>
            </div>
          </div>
        </el-card>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
defineOptions({ name: 'GenreCatalog' });
import { ref, onMounted, onActivated, computed } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { genreCategories } from '../config/genres';
import { useScanStore } from '../stores/scanStore';

const router = useRouter();
const scanStore = useScanStore();
const lastRefreshedDataVersion = ref(0);
const loading = ref(true);
const dbGenres = ref([]); // 数据库中的分类

const loadGenres = async () => {
  try {
    loading.value = true;
    const result = await window.electronAPI.genres.getList();
    if (result.success) {
      dbGenres.value = result.data || [];
      lastRefreshedDataVersion.value = scanStore.dataVersion;
    } else {
      ElMessage.error('加载分类列表失败: ' + (result.message || '未知错误'));
    }
  } catch (error) {
    console.error('加载分类列表失败:', error);
    ElMessage.error('加载分类列表失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

// 将标准分类配置与数据库中的分类合并
const groupedGenres = computed(() => {
  // 创建数据库分类的映射（按名称）
  const dbGenreMap = new Map();
  dbGenres.value.forEach(genre => {
    dbGenreMap.set(genre.name, genre);
  });

  // 处理每个大类
  return genreCategories.map(category => {
    const genres = category.genres.map(genreName => {
      const dbGenre = dbGenreMap.get(genreName);
      if (dbGenre) {
        // 数据库中存在该分类
        return {
          name: genreName,
          id: dbGenre.id,
          inDatabase: true,
          playableCount: dbGenre.playableCount || 0,
          totalCount: dbGenre.totalCount || 0
        };
      } else {
        // 数据库中不存在该分类
        return {
          name: genreName,
          id: null,
          inDatabase: false,
          playableCount: 0,
          totalCount: 0
        };
      }
    });

    return {
      name: category.name,
      genres
    };
  });
});

const goToGenreDetail = async (genreId, genreName) => {
  if (genreId) {
    // 数据库中存在该分类，直接跳转
    router.push(`/genre/${genreId}`);
  } else {
    // 数据库中不存在，尝试创建或查找
    try {
      const result = await window.electronAPI.genres.getOrCreateByName(genreName);
      if (result.success && result.data) {
        router.push(`/genre/${result.data.id}`);
      } else {
        ElMessage.warning(`分类"${genreName}"暂无数据`);
      }
    } catch (error) {
      console.error('创建分类失败:', error);
      ElMessage.warning(`分类"${genreName}"暂无数据`);
    }
  }
};

const goBack = () => {
  // 统一使用浏览器历史记录返回上一页
  // 页面状态会在目标页面的 onMounted 中自动恢复（通过 pageState 工具）
  if (window.history.length > 1) {
    router.back();
  } else {
    // 如果没有历史记录，返回到首页
    router.push('/');
  }
};

onActivated(() => {
  if (scanStore.dataVersion > lastRefreshedDataVersion.value) {
    lastRefreshedDataVersion.value = scanStore.dataVersion;
    loadGenres();
  }
});

onMounted(() => {
  loadGenres();
});
</script>

<style scoped>
.genre-list {
  width: 100%;
  min-height: 100%;
}

.header-content {
  display: flex;
  align-items: center;
}

.el-header {
  background-color: #409eff;
  color: white;
  display: flex;
  align-items: center;
  padding: 0 20px;
}

.genres-container {
  padding: 16px 0;
}

.category-section {
  margin-bottom: 32px;
}

.category-title {
  font-size: 20px;
  font-weight: bold;
  color: #303133;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 2px solid #409eff;
}

.genres-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  gap: 6px;
  margin-bottom: 24px;
}

.genre-card {
  cursor: pointer;
  transition: transform 0.2s, opacity 0.2s;
}

.genre-card:hover:not(.genre-disabled) {
  transform: translateY(-4px);
}

.genre-disabled {
  cursor: not-allowed;
  opacity: 0.6;
  background-color: #f5f5f5;
}

.genre-info {
  text-align: center;
  padding: 4px;
}

.genre-name {
  font-size: 12px;
  font-weight: bold;
  margin-bottom: 2px;
  color: #303133;
}

.genre-name-disabled {
  color: #909399;
}

.genre-meta {
  font-size: 10px;
  color: #909399;
}

.genre-meta-disabled {
  color: #c0c4cc;
}

.playable-count {
  color: #67c23a;
  font-weight: bold;
}

/* 当可播放条数为0时，不应用绿色样式 */
.genre-meta span:not(.playable-count) {
  color: inherit;
  font-weight: normal;
}
</style>
