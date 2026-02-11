<template>
  <div class="series-list">
    <el-container>
      <el-header>
        <div class="header-content">
          <el-button @click="goBack" icon="ArrowLeft">返回</el-button>
          <h1 style="margin: 0; margin-left: 16px;">系列：{{ seriesPrefix }}</h1>
        </div>
      </el-header>
      <el-main>
        <MovieListLayout
          :loading="loading"
          :movies="movies"
          :total="movies.length"
          :current-page="1"
          :page-size="movies.length"
          sort-by="premiered-desc"
          view-mode="thumbnail"
          :image-cache="imageCache"
          empty-text="暂无影片数据"
          :show-pagination="false"
          :enableViewModeToggle="false"
          :load-movie-image="(movie) => loadMovieImage(movie.poster_path, movie.data_path_index)"
          @rowClick="goToMovieDetail"
        />
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import MovieListLayout from '../components/MovieListLayout.vue';
import { getImageCacheKey } from '../utils/imageLoader';

const router = useRouter();
const route = useRoute();
const seriesPrefix = computed(() => route.params.prefix);

const loading = ref(true);
const movies = ref([]);
const imageCache = ref({}); // 图片缓存

const loadMovies = async () => {
  try {
    loading.value = true;
    // 使用系列前缀查询，不需要完整的code
    const result = await window.electronAPI.movies.getSeries(seriesPrefix.value);
    if (result.success) {
      movies.value = result.data || [];
      // 使用全局图片加载管理器分批加载图片
      const { loadImagesBatch } = await import('../utils/imageLoader');
      loadImagesBatch(movies.value, imageCache.value, 20);
    } else {
      ElMessage.error('加载系列影片失败: ' + (result.message || '未知错误'));
    }
  } catch (error) {
    console.error('加载系列影片失败:', error);
    ElMessage.error('加载系列影片失败: ' + error.message);
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

const goToMovieDetail = (movieId) => {
  if (typeof movieId === 'object') {
    movieId = movieId.id;
  }
  router.push(`/movie/${movieId}`);
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

onMounted(() => {
  loadMovies();
});
</script>

<style scoped>
.series-list {
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
</style>
