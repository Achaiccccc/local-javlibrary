<template>
  <div class="movie-list-page">
    <el-container>
      <el-header>
        <div class="header-content">
          <el-button v-if="listType !== 'home'" @click="goBack" icon="ArrowLeft">返回</el-button>
          <h1 style="margin: 0; margin-left: listType === 'home' ? 0 : 16px;">{{ headerTitle }}</h1>
        </div>
      </el-header>
      <el-main ref="mainContentRef">
        <MovieListLayout
          :loading="loading"
          :movies="movies"
          :total="total"
          :current-page="currentPage"
          :page-size="listParams.pageSize"
          :sort-by="listParams.sortBy"
          :view-mode="listParams.viewMode"
          :image-cache="imageCache"
          :empty-text="emptyText"
          :enable-view-mode-toggle="true"
          :show-pagination="showPagination"
          @update:pageSize="handlePageSizeChange"
          @update:currentPage="handlePageChange"
          @update:sortBy="handleSortByChange"
          @update:viewMode="handleViewModeChange"
          @rowClick="goToMovieDetail"
          :load-movie-image="movie => loadMovieImage(movie.poster_path, movie.data_path_index)"
        >
          <template v-if="listType === 'search'" #left-extra>
            <span style="margin-left: 16px; color: #909399;">共找到 {{ total }} 条结果</span>
          </template>
        </MovieListLayout>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import MovieListLayout from '../components/MovieListLayout.vue';
import { useListParamsStore } from '../stores/listParamsStore';
import { savePageState, getPageState, saveScrollPosition, restoreScrollPosition, clearScrollPosition } from '../utils/pageState';
import { loadImagesBatch, pauseBackgroundLoading, resumeBackgroundLoading, loadImage } from '../utils/imageLoader';
import { withLoadingOptimization } from '../utils/loadingOptimizer';

const router = useRouter();
const route = useRoute();
const listParams = useListParamsStore();

const loading = ref(true);
const movies = ref([]);
const total = ref(0);
const imageCache = ref({});
const mainContentRef = ref(null);
const listType = computed(() => {
  const path = route.path;
  if (path === '/') return 'home';
  if (path.startsWith('/actor/')) return 'actor';
  if (path.startsWith('/genre/')) return 'genre';
  if (path.startsWith('/director/')) return 'director';
  if (path.startsWith('/studio/')) return 'studio';
  if (path.startsWith('/series/')) return 'series';
  if (path === '/search/results') return 'search';
  return 'home';
});

const pageKey = computed(() => {
  switch (listType.value) {
    case 'home': return 'home';
    case 'actor': return 'actor_' + (route.params.id ?? '');
    case 'genre': return 'genre_' + (route.params.id ?? '');
    case 'director': return 'director_' + (route.params.id ?? '');
    case 'studio': return 'studio_' + (route.params.id ?? '');
    case 'series': return 'series_' + (route.params.prefix ?? '');
    case 'search': return 'search';
    default: return 'home';
  }
});

const headerTitle = computed(() => {
  switch (listType.value) {
    case 'home': return 'JavLibrary - 本地影视库';
    case 'actor': return actorName.value || (viewModeFromQuery.value === 'folder' ? '文件目录详情' : '女优详情');
    case 'genre': return genreName.value || '分类详情';
    case 'director': return directorName.value || '导演详情';
    case 'studio': return studioName.value || '制作商详情';
    case 'series': return '系列：' + (route.params.prefix ?? '');
    case 'search': return '搜索结果';
    default: return '影片列表';
  }
});

const actorName = ref('');
const genreName = ref('');
const directorName = ref('');
const studioName = ref('');
const viewModeFromQuery = computed(() => route.query.viewMode || (typeof route.params.id === 'string' && isNaN(parseInt(route.params.id)) ? 'folder' : 'actor'));

const emptyText = computed(() => (listType.value === 'search' ? '未找到匹配的影片' : '暂无影片数据'));
const showPagination = computed(() => {
  if (listType.value === 'search') return total.value > listParams.pageSize;
  return true;
});

const currentPage = ref(1);

function syncCurrentPageFromState() {
  currentPage.value = getPageState(pageKey.value, { currentPage: 1 }).currentPage ?? 1;
}

const loadDataRaw = async () => {
  loading.value = true;
  const page = currentPage.value;
  const pageSize = listParams.pageSize;
  const sortBy = listParams.sortBy;
  let result = { success: false, data: [], total: 0 };

  try {
    switch (listType.value) {
      case 'home': {
        result = await window.electronAPI.movies.getList({ page, pageSize, sortBy });
        break;
      }
      case 'actor': {
        const id = viewModeFromQuery.value === 'folder' ? decodeURIComponent(route.params.id) : parseInt(route.params.id);
        if (id == null || (viewModeFromQuery.value === 'actor' && isNaN(id))) {
          ElMessage.error('无效的演员ID');
          loading.value = false;
          return;
        }
        result = await window.electronAPI.actors.getMovies(id, { page, pageSize, sortBy, viewMode: viewModeFromQuery.value });
        if (result.success && result.actor?.name) actorName.value = result.actor.name;
        else if (viewModeFromQuery.value === 'folder' && id) actorName.value = String(id);
        else if (result.success && viewModeFromQuery.value === 'actor' && !isNaN(id)) {
          try {
            const ar = await window.electronAPI.actors.getById(id, { viewMode: viewModeFromQuery.value });
            if (ar?.success && ar?.data?.name) actorName.value = ar.data.name;
            else actorName.value = '演员 ' + id;
          } catch (_) { actorName.value = '演员 ' + id; }
        }
        break;
      }
      case 'genre': {
        const genreId = parseInt(route.params.id);
        result = await window.electronAPI.movies.getList({ page, pageSize, sortBy, genreId });
        if (result.success && result.data?.length && result.data[0].genres) {
          const g = result.data[0].genres.find(x => x.id === genreId);
          if (g) genreName.value = g.name;
        }
        break;
      }
      case 'director': {
        const directorId = parseInt(route.params.id);
        result = await window.electronAPI.directors.getMovies(directorId, { page, pageSize, sortBy });
        if (result.success && result.director?.name) directorName.value = result.director.name;
        else if (result.success && directorId) directorName.value = '导演 ' + directorId;
        break;
      }
      case 'studio': {
        const studioId = parseInt(route.params.id);
        result = await window.electronAPI.studios.getMovies(studioId, { page, pageSize, sortBy });
        if (result.success && result.studio?.name) studioName.value = result.studio.name;
        else if (result.success && studioId) studioName.value = '制作商 ' + studioId;
        break;
      }
      case 'series': {
        const prefix = route.params.prefix;
        result = await window.electronAPI.movies.getSeries(prefix, { page, pageSize, sortBy });
        break;
      }
      case 'search': {
        const q = route.query;
        if (q.type === 'simple') {
          result = await window.electronAPI.search.simple(q.keyword || '', { page, pageSize, sortBy });
        } else if (q.type === 'advanced') {
          const params = { page, pageSize, sortBy };
          if (q.title) params.title = q.title;
          if (q.dateFrom) params.dateFrom = q.dateFrom;
          if (q.dateTo) params.dateTo = q.dateTo;
          if (q.director) params.director = q.director;
          if (q.studio) params.studio = q.studio;
          if (q.genre) params.genre = q.genre;
          if (q.actor) params.actor = q.actor;
          result = await window.electronAPI.search.advanced(params);
        } else {
          ElMessage.error('无效的搜索类型');
        }
        break;
      }
      default:
        result = await window.electronAPI.movies.getList({ page, pageSize, sortBy });
    }
  } catch (err) {
    console.error('loadData error:', err);
    ElMessage.error('加载失败: ' + (err.message || '未知错误'));
    loading.value = false;
    return;
  }

  if (result.code === 'DB_NOT_READY') {
    ElMessage.info(result.message || '数据库正在准备中，请稍候');
    loading.value = false;
    return;
  }
  if (!result.success) {
    ElMessage.error('加载失败: ' + (result.message || '未知错误'));
    loading.value = false;
    return;
  }

  const totalCount = result.total ?? 0;
  const pageMax = pageSize > 0 ? Math.max(1, Math.ceil(totalCount / pageSize)) : 1;
  if (currentPage.value > pageMax && totalCount > 0) {
    currentPage.value = 1;
    savePageState(pageKey.value, { currentPage: 1 });
    loading.value = false;
    return loadDataRaw();
  }

  movies.value = result.data || [];
  total.value = totalCount;
  loadImagesBatch(movies.value, imageCache.value, 20);
  loading.value = false;
};

const loadData = withLoadingOptimization(loadDataRaw);

async function loadMovieImage(posterPath, dataPathIndex = 0) {
  return await loadImage(posterPath, dataPathIndex, false, imageCache.value);
}

function handlePageChange(page) {
  currentPage.value = page;
  savePageState(pageKey.value, { currentPage: page });
  clearScrollPosition(pageKey.value);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  loadData();
}

function handlePageSizeChange(size) {
  listParams.setPageSize(size);
  currentPage.value = 1;
  savePageState(pageKey.value, { currentPage: 1 });
  clearScrollPosition(pageKey.value);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  loadData();
}

function handleSortByChange(val) {
  listParams.setSortBy(val);
  currentPage.value = 1;
  savePageState(pageKey.value, { currentPage: 1 });
  clearScrollPosition(pageKey.value);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  loadData();
}

function handleViewModeChange(val) {
  listParams.setViewMode(val);
}

function goToMovieDetail(movieId) {
  const id = typeof movieId === 'object' ? movieId?.id : movieId;
  if (!id) return;
  pauseBackgroundLoading();
  savePageState(pageKey.value, { currentPage: currentPage.value });
  saveScrollPosition(pageKey.value);
  router.push({ path: `/movie/${id}` });
}

function goBack() {
  if (window.history.length > 1) {
    router.back();
  } else {
    if (listType.value === 'actor') router.push('/actors');
    else if (listType.value === 'genre') router.push('/genres');
    else if (listType.value === 'director') router.push('/directors');
    else if (listType.value === 'studio') router.push('/studios');
    else if (listType.value === 'series' || listType.value === 'search') router.push('/');
    else router.push('/');
  }
}

watch(() => [route.path, route.params, route.query], () => {
  syncCurrentPageFromState();
  loadData();
}, { deep: true });

onMounted(() => {
  resumeBackgroundLoading();
  syncCurrentPageFromState();
  const query = route.query;
  if (query.page != null) {
    const p = parseInt(query.page);
    if (!isNaN(p) && p >= 1) {
      currentPage.value = p;
      savePageState(pageKey.value, { currentPage: p });
    }
  }
  let loadCalled = false;
  const doLoad = () => {
    if (loadCalled) return;
    loadCalled = true;
    loadData();
  };
  const tryLoad = async () => {
    try {
      const res = await window.electronAPI?.system?.isDatabaseReady?.();
      if (res?.ready) { doLoad(); return; }
    } catch (e) {}
    const start = Date.now();
    const t = setInterval(async () => {
      if (loadCalled || Date.now() - start >= 15000) {
        clearInterval(t);
        if (!loadCalled) doLoad();
        return;
      }
      try {
        const res = await window.electronAPI?.system?.isDatabaseReady?.();
        if (res?.ready) { clearInterval(t); doLoad(); }
      } catch (e) {}
    }, 400);
  };
  if (window.electronAPI?.system?.onDatabaseReady) {
    window.electronAPI.system.onDatabaseReady(() => { if (!loadCalled) doLoad(); });
  }
  tryLoad();
  restoreScrollPosition(pageKey.value, 200);

  if (window.electronAPI?.system?.onFileChange) {
    window.electronAPI.system.onFileChange(() => loadData());
  }
  if (window.electronAPI?.system?.onScanCompleted) {
    window.electronAPI.system.onScanCompleted(() => {
      currentPage.value = 1;
      savePageState(pageKey.value, { currentPage: 1 });
      clearScrollPosition(pageKey.value);
      loadData();
    });
  }
  window.addEventListener('filterPlayableChanged', () => loadData());
});

onBeforeUnmount(() => {
  savePageState(pageKey.value, { currentPage: currentPage.value });
  saveScrollPosition(pageKey.value);
});
</script>

<style scoped>
.movie-list-page { width: 100%; height: 100%; }
.header-content { display: flex; align-items: center; }
.el-header {
  background-color: #409eff;
  color: white;
  display: flex;
  align-items: center;
  padding: 0 20px;
}
</style>
