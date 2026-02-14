<template>
  <div class="search-results">
    <el-container>
      <el-header>
        <div class="header-content">
          <el-button @click="goBack" icon="ArrowLeft">返回</el-button>
          <h1 style="margin: 0; margin-left: 16px;">搜索结果</h1>
        </div>
      </el-header>
      <el-main ref="mainContentRef">
        <MovieListLayout
          :loading="loading"
          :movies="displayedMovies"
          :total="total"
          :current-page="currentPage"
          :page-size="pageSize"
          :sort-by="sortBy"
          :view-mode="displayViewMode"
          :image-cache="imageCache"
          empty-text="未找到匹配的影片"
          :show-pagination="total > pageSize"
          :load-movie-image="(movie) => loadMovieImage(movie.poster_path, movie.data_path_index)"
          @update:pageSize="handlePageSizeChange"
          @update:currentPage="handlePageChange"
          @update:sortBy="handleSortByChange"
          @update:viewMode="handleViewModeChangeWithVal"
          @rowClick="goToMovieDetail"
        >
          <template #left-extra>
            <span style="margin-left: 16px; color: #909399;">
              共找到 {{ total }} 条结果
            </span>
          </template>
        </MovieListLayout>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeMount, computed, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import MovieListLayout from '../components/MovieListLayout.vue';
import { getImageCacheKey } from '../utils/imageLoader';

const router = useRouter();
const route = useRoute();

const loading = ref(true);
const movies = ref([]);
const total = ref(0);
const currentPage = ref(1);
const pageSize = ref(20);
const sortBy = ref('premiered-desc');
const displayViewMode = ref('thumbnail');
const imageCache = ref({});

function handleSortByChange(val) {
  sortBy.value = val;
}
function handleViewModeChangeWithVal(val) {
  displayViewMode.value = val;
  handleViewModeChange();
}

const displayedMovies = computed(() => {
  let result = [...movies.value];
  
  // 排序
  if (sortBy.value === 'title-asc') {
    result.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  } else if (sortBy.value === 'title-desc') {
    result.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
  } else if (sortBy.value === 'premiered-asc') {
    result.sort((a, b) => {
      const dateA = a.premiered || '';
      const dateB = b.premiered || '';
      return dateA.localeCompare(dateB);
    });
  } else if (sortBy.value === 'folder_updated_at-asc') {
    result.sort((a, b) => {
      const tA = a.folder_updated_at ? new Date(a.folder_updated_at).getTime() : 0;
      const tB = b.folder_updated_at ? new Date(b.folder_updated_at).getTime() : 0;
      return tA - tB;
    });
  } else if (sortBy.value === 'folder_updated_at-desc') {
    result.sort((a, b) => {
      const tA = a.folder_updated_at ? new Date(a.folder_updated_at).getTime() : 0;
      const tB = b.folder_updated_at ? new Date(b.folder_updated_at).getTime() : 0;
      return tB - tA;
    });
  } else {
    // premiered-desc (默认)
    result.sort((a, b) => {
      const dateA = a.premiered || '';
      const dateB = b.premiered || '';
      return dateB.localeCompare(dateA);
    });
  }
  
  // 分页
  const start = (currentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return result.slice(start, end);
});

const loadSearchResults = async () => {
  try {
    loading.value = true;
    
    const query = route.query;
    let result;
    
    if (query.type === 'simple') {
      // 简易搜索
      result = await window.electronAPI.search.simple(query.keyword);
    } else if (query.type === 'advanced') {
      // 多重搜索
      const params = {};
      if (query.title) params.title = query.title;
      if (query.dateFrom) params.dateFrom = query.dateFrom;
      if (query.dateTo) params.dateTo = query.dateTo;
      if (query.director) params.director = query.director;
      if (query.studio) params.studio = query.studio;
      if (query.genre) params.genre = query.genre;
      if (query.actor) params.actor = query.actor;
      
      result = await window.electronAPI.search.advanced(params);
    } else {
      ElMessage.error('无效的搜索类型');
      return;
    }
    
    if (result.success) {
      movies.value = result.data || [];
      total.value = result.total || 0;
      
      // 使用全局图片加载管理器分批加载图片
      const { loadImagesBatch } = await import('../utils/imageLoader');
      loadImagesBatch(movies.value, imageCache.value, 20);
    } else {
      ElMessage.error('加载搜索结果失败: ' + (result.message || '未知错误'));
    }
  } catch (error) {
    console.error('加载搜索结果失败:', error);
    ElMessage.error('加载搜索结果失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

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
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

const handlePageSizeChange = (size) => {
  pageSize.value = size;
  currentPage.value = 1;
};

const handleViewModeChange = () => {
  // 视图模式切换不需要重新加载数据
};

watch(sortBy, () => {
  currentPage.value = 1;
});

const goToMovieDetail = (movieId) => {
  if (typeof movieId === 'object') {
    movieId = movieId.id;
  }
  router.push({
    path: `/movie/${movieId}`,
    query: {
      from: 'search',
      ...route.query
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
  loadSearchResults();
});
</script>

<style scoped>
.search-results {
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
</style>
