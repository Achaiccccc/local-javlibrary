<template>
  <div class="studio-detail">
    <el-container>
      <el-header>
        <div class="header-content">
          <el-button @click="goBack" icon="ArrowLeft">返回</el-button>
          <h1 style="margin: 0; margin-left: 16px;">{{ studioName || '制作商详情' }}</h1>
        </div>
      </el-header>
      <el-main ref="mainContentRef">
        <MovieListLayout
          :loading="loading"
          :movies="movies"
          :total="total"
          :current-page="currentPage"
          :page-size="pageSize"
          :sort-by="sortBy"
          :view-mode="displayViewMode"
          :image-cache="imageCache"
          :enable-view-mode-toggle="true"
          @update:pageSize="handlePageSizeChange"
          @update:currentPage="handlePageChange"
          @update:sortBy="handleSortByChange"
          @update:viewMode="handleViewModeChangeWithVal"
          @rowClick="goToMovieDetail"
          :load-movie-image="movie => loadMovieImage(movie.poster_path, movie.data_path_index)"
        />
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeMount, onBeforeUnmount, computed, watch, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { VideoPlay } from '@element-plus/icons-vue';
import MovieListLayout from '../components/MovieListLayout.vue';
import { savePageState, getPageState, saveScrollPosition, restoreScrollPosition } from '../utils/pageState';
import { withLoadingOptimization } from '../utils/loadingOptimizer';
import { loadImagesBatch, pauseBackgroundLoading, getImageCacheKey } from '../utils/imageLoader';

const router = useRouter();
const route = useRoute();
const studioId = computed(() => parseInt(route.params.id));

const loading = ref(true);
const movies = ref([]);
const total = ref(0);
const pageKey = computed(() => `studio_${studioId.value}`);
const mainContentRef = ref(null);

const getInitialState = () => {
  if (studioId.value) {
    return getPageState(pageKey.value, {
      currentPage: 1,
      pageSize: 20,
      sortBy: 'premiered-desc'
    });
  }
  return { currentPage: 1, pageSize: 20, sortBy: 'premiered-desc' };
};

const currentPage = ref(getInitialState().currentPage);
const pageSize = ref(getInitialState().pageSize);
const sortBy = ref(getInitialState().sortBy);
const displayViewMode = ref('thumbnail');
const studioName = ref('');
const imageCache = ref({});

function handleSortByChange(val) {
  sortBy.value = val;
}
function handleViewModeChangeWithVal(val) {
  displayViewMode.value = val;
  handleViewModeChange();
}

const loadMoviesRaw = async () => {
  loading.value = true;
  
  if (!studioId.value) {
    ElMessage.error('无效的制作商ID');
    loading.value = false;
    return;
  }
  
  const result = await window.electronAPI.studios.getMovies(studioId.value, {
    page: currentPage.value,
    pageSize: pageSize.value,
    sortBy: sortBy.value
  });
  
  if (result.success) {
    movies.value = result.data || [];
    total.value = result.total || 0;
    if (result.studio && result.studio.name) {
      studioName.value = result.studio.name;
    } else if (studioId.value) {
      studioName.value = `制作商 ${studioId.value}`;
    }
    
    // 使用全局图片加载管理器分批加载图片
    loadImagesBatch(movies.value, imageCache.value, 20);
  } else if (result.code === 'DB_NOT_READY') {
    ElMessage.info(result.message || '数据库正在准备中，请稍候');
  } else {
    ElMessage.error('加载影片列表失败: ' + (result.message || '未知错误'));
  }
  loading.value = false;
  return result;
};

// 包装后的加载函数，自动处理暂停/恢复
const loadMovies = withLoadingOptimization(loadMoviesRaw);

const loadMovieImage = async (posterPath, dataPathIndex = 0) => {
  const cacheKey = getImageCacheKey(posterPath, dataPathIndex);
  if (!posterPath || imageCache.value[cacheKey]) {
    return;
  }
  
  try {
    const imageUrl = await window.electronAPI?.movies?.getImage?.(posterPath, dataPathIndex);
    if (imageUrl) {
      imageCache.value[cacheKey] = imageUrl;
    }
  } catch (error) {
    console.error('加载图片失败:', error);
  }
};

const handlePageChange = (page) => {
  currentPage.value = page;
  // 翻页时滚动到顶部
  window.scrollTo({ top: 0, behavior: 'smooth' });
  loadMovies();
};

const handlePageSizeChange = (size) => {
  pageSize.value = size;
  currentPage.value = 1;
  loadMovies();
};

const handleViewModeChange = () => {
  // 视图模式切换不需要重新加载数据
};

watch(sortBy, () => {
  currentPage.value = 1;
  loadMovies();
});

const goToMovieDetail = (movieId) => {
  if (typeof movieId === 'object') {
    movieId = movieId.id;
  }
  // 暂停后台图片加载，优先处理用户请求
  pauseBackgroundLoading();
  
  if (studioId.value) {
    savePageState(pageKey.value, {
      currentPage: currentPage.value,
      pageSize: pageSize.value,
      sortBy: sortBy.value
    });
    saveScrollPosition(pageKey.value);
  }
  router.push({
    path: `/movie/${movieId}`,
    query: {
      from: 'studio',
      studioId: studioId.value,
      page: currentPage.value,
      pageSize: pageSize.value,
      sortBy: sortBy.value
    }
  });
};

const goBack = () => {
  router.back();
};

onBeforeMount(() => {
  window.scrollTo({ top: 0, behavior: 'auto' });
});

onMounted(() => {
  const query = route.query;
  let restored = false;
  
  if (query.page) {
    currentPage.value = parseInt(query.page) || 1;
    restored = true;
  }
  if (query.pageSize) {
    pageSize.value = parseInt(query.pageSize) || 20;
    restored = true;
  }
  if (query.sortBy) {
    sortBy.value = query.sortBy;
    restored = true;
  }
  
  if (restored && studioId.value) {
    savePageState(pageKey.value, {
      currentPage: currentPage.value,
      pageSize: pageSize.value,
      sortBy: sortBy.value
    });
  }
  
  loadMovies();
  
  if (studioId.value) {
    restoreScrollPosition(pageKey.value, 200);
  }
});

onBeforeUnmount(() => {
  if (studioId.value) {
    savePageState(pageKey.value, {
      currentPage: currentPage.value,
      pageSize: pageSize.value,
      sortBy: sortBy.value
    });
    saveScrollPosition(pageKey.value);
  }
});
</script>

<style scoped>
.studio-detail {
  width: 100%;
  height: 100%;
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

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
}

.empty-state {
  padding: 40px 0;
}

.movies-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 16px;
  padding: 16px 0;
}

.movie-card {
  cursor: pointer;
  transition: transform 0.2s;
}

.movie-card:hover {
  transform: translateY(-4px);
}

.movie-poster {
  position: relative;
  width: 100%;
  aspect-ratio: 0.7;
  max-height: 300px;
  overflow: hidden;
  background-color: #f5f5f5;
}

.play-icon {
  position: absolute;
  bottom: 8px;
  left: 8px;
  background-color: rgba(0, 0, 0, 0.6);
  border-radius: 50%;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.image-slot {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
  background: #f5f5f5;
  color: #909399;
  font-size: 14px;
}

.movie-info {
  padding: 12px;
  text-align: center;
}

.movie-title {
  font-size: 14px;
  font-weight: bold;
  margin-bottom: 4px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.movie-meta {
  font-size: 12px;
  color: #909399;
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}
</style>
