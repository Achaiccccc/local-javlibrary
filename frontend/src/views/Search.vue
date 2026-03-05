<template>
  <div class="search">
    <el-container>
      <el-header class="page-header">
        <div class="header-content">
          <h1 class="header-title">搜索</h1>
          <ThemeSwitch />
        </div>
      </el-header>
      <el-main class="page-theme-bg">
        <el-card>
          <el-tabs v-model="activeTab">
            <!-- 简易搜索 -->
            <el-tab-pane label="简易搜索" name="simple">
              <el-form :model="simpleForm" @submit.prevent="handleSimpleSearch">
                <el-form-item label="关键词">
                  <el-input
                    v-model="simpleForm.keyword"
                    placeholder="请输入影片标题、识别码、演员等信息"
                    clearable
                    @keyup.enter="handleSimpleSearch"
                  >
                    <template #append>
                      <el-button @click="handleSimpleSearch" :loading="searching">搜索</el-button>
                    </template>
                  </el-input>
                </el-form-item>
              </el-form>
              <!-- 简易搜索结果区：仅卡片网格 + 共 N 条 + 查看全部，网格最多两行 -->
              <div class="simple-result-area">
                <template v-if="!simpleForm.keyword || simpleForm.keyword.trim() === ''">
                  <div class="simple-result-placeholder">输入影片标题、识别码、演员等信息，结果将显示在下方，或点击搜索进入列表页查看全部结果</div>
                </template>
                <template v-else-if="simpleLoading">
                  <div class="simple-result-loading">加载中...</div>
                </template>
                <template v-else-if="simpleTotal === 0">
                  <div class="simple-result-empty">未找到匹配的影片</div>
                </template>
                <template v-else>
                  <p class="simple-result-total">共 {{ simpleTotal }} 条结果</p>
                  <div ref="simpleGridWrapRef" class="simple-result-grid-wrap">
                    <div class="simple-result-grid">
                      <el-card
                        v-for="movie in simpleDisplayedResults"
                      :key="movie.id"
                      class="movie-card"
                      shadow="hover"
                      @click="goToMovieDetail(movie)"
                    >
                      <div class="movie-poster">
                        <el-image
                          :src="simpleImageCache[getImageCacheKey(movie?.poster_path, movie?.data_path_index)] || ''"
                          fit="contain"
                          style="width: 100%; height: 100%;"
                          :lazy="true"
                          @load="() => loadMovieImage(movie)"
                        >
                          <template #error>
                            <div class="image-slot">暂无封面</div>
                          </template>
                        </el-image>
                        <div v-if="movie.playable" class="play-icon" @click.stop="onPlayVideo(movie)">
                          <el-icon :size="24" color="#67c23a">
                            <VideoPlay />
                          </el-icon>
                        </div>
                        <div
                          class="favorite-icon"
                          :class="{ 'is-favorited': isSimpleFavorited(movie) }"
                          @click.stop="onToggleFavorite(movie)"
                        >
                          <el-icon :size="20">
                            <StarFilled v-if="isSimpleFavorited(movie)" />
                            <Star v-else />
                          </el-icon>
                        </div>
                      </div>
                      <div class="movie-info">
                        <div class="movie-title" :title="movie.title">{{ movie.title }}</div>
                        <div class="movie-meta">{{ movie.code }}</div>
                      </div>
                      </el-card>
                    </div>
                  </div>
                  <div class="simple-result-actions">
                    <el-button type="primary" @click="goToSearchResults">查看全部</el-button>
                  </div>
                </template>
              </div>
              <FavoriteFoldersDialog
                v-model="favoriteDialogVisible"
                :movie="favoriteDialogMovie"
                @done="onFavoriteDialogDone"
              />
            </el-tab-pane>
            
            <!-- 多重搜索 -->
            <el-tab-pane label="多重搜索" name="advanced">
              <el-form :model="advancedForm" label-width="120px" @submit.prevent="handleAdvancedSearch">
                <el-form-item label="影片标题">
                  <el-input
                    v-model="advancedForm.title"
                    placeholder="请输入影片标题（模糊匹配）"
                    clearable
                  />
                </el-form-item>
                <el-form-item label="发行日期">
                  <el-date-picker
                    v-model="advancedForm.dateRange"
                    type="daterange"
                    range-separator="至"
                    start-placeholder="开始日期"
                    end-placeholder="结束日期"
                    format="YYYY-MM-DD"
                    value-format="YYYY-MM-DD"
                    class="advanced-date-picker"
                  />
                </el-form-item>
                <el-form-item label="导演">
                  <el-select
                    v-model="advancedForm.director"
                    filterable
                    allow-create
                    default-first-option
                    placeholder="选择或输入导演名称"
                    style="width: 100%;"
                    clearable
                  >
                    <el-option
                      v-for="director in availableDirectors"
                      :key="director"
                      :label="director"
                      :value="director"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="制作商">
                  <el-select
                    v-model="advancedForm.studio"
                    filterable
                    allow-create
                    default-first-option
                    placeholder="选择或输入制作商名称"
                    style="width: 100%;"
                    clearable
                  >
                    <el-option
                      v-for="studio in availableStudios"
                      :key="studio"
                      :label="studio"
                      :value="studio"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="分类">
                  <el-select
                    v-model="advancedForm.genre"
                    filterable
                    allow-create
                    default-first-option
                    placeholder="选择或输入分类名称"
                    style="width: 100%;"
                    clearable
                  >
                    <el-option
                      v-for="genre in availableGenres"
                      :key="genre"
                      :label="genre"
                      :value="genre"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="演员">
                  <el-select
                    v-model="advancedForm.actor"
                    filterable
                    allow-create
                    default-first-option
                    placeholder="选择或输入演员名称"
                    style="width: 100%;"
                    clearable
                  >
                    <el-option
                      v-for="actor in availableActors"
                      :key="actor"
                      :label="actor"
                      :value="actor"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item>
                  <el-button type="primary" @click="handleAdvancedSearch" :loading="searching">
                    搜索
                  </el-button>
                  <el-button @click="resetAdvancedForm">重置</el-button>
                </el-form-item>
              </el-form>
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
defineOptions({ name: 'Search' });
import { ref, computed, watch, onMounted, onActivated, onBeforeUnmount } from 'vue';
import { useElementSize } from '@vueuse/core';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { VideoPlay, Star, StarFilled } from '@element-plus/icons-vue';
import { useScanStore } from '../stores/scanStore';
import { useListParamsStore } from '../stores/listParamsStore';
import { getImageCacheKey, loadImage, loadImagesBatch } from '../utils/imageLoader';
import ThemeSwitch from '../components/ThemeSwitch.vue';
import FavoriteFoldersDialog from '../components/FavoriteFoldersDialog.vue';

const DEBOUNCE_MS = 700;
/** 简易搜索下方展示条数：至少填满两行。大窗口下一行可展示约 11 条，两行需 22 条，取 24 留余量 */
const SIMPLE_PAGE_SIZE = 24;

const router = useRouter();
const scanStore = useScanStore();
const listParams = useListParamsStore();
const lastRefreshedDataVersion = ref(0);
const activeTab = ref('simple');
const searching = ref(false);

const simpleForm = ref({
  keyword: ''
});
const simpleResults = ref([]);
const simpleTotal = ref(0);
const simpleLoading = ref(false);
const simpleImageCache = ref({});
const simpleFavoriteFolderIdsByCode = ref({});
const simpleDebounceTimer = ref(null);
const favoriteDialogVisible = ref(false);
const favoriteDialogMovie = ref(null);

/** 网格容器 ref，用于根据宽度计算每行可展示的卡片数，仅展示 2 行避免底部被裁切 */
const simpleGridWrapRef = ref(null);
const { width: simpleGridWrapWidth } = useElementSize(simpleGridWrapRef);
const SIMPLE_GRID_MIN_CARD = 210;
const SIMPLE_GRID_GAP = 16;
/** 根据容器宽度估算每行卡片数（与 CSS grid auto-fill minmax(210px,1fr) 一致） */
const simpleGridColumns = computed(() => {
  const w = simpleGridWrapWidth.value || 800;
  return Math.max(1, Math.floor((w + SIMPLE_GRID_GAP) / (SIMPLE_GRID_MIN_CARD + SIMPLE_GRID_GAP)));
});
/** 仅展示前 2 行的条目，避免窗口缩小时卡片变大导致底部被裁切 */
const simpleDisplayedResults = computed(() => {
  const list = simpleResults.value;
  const count = simpleGridColumns.value * 2;
  return list.slice(0, count);
});

const advancedForm = ref({
  title: '',
  dateRange: null,
  director: '',
  studio: '',
  genre: '',
  actor: ''
});

const availableDirectors = ref([]);
const availableStudios = ref([]);
const availableGenres = ref([]);
const availableActors = ref([]);

const loadOptions = async () => {
  try {
    const [directorsResult, studiosResult, genresResult, actorsResult] = await Promise.all([
      window.electronAPI.directors.getList({ namesOnly: true }),
      window.electronAPI.studios.getList({ namesOnly: true }),
      window.electronAPI.genres.getList({ namesOnly: true }),
      window.electronAPI.actors.getList({ viewMode: 'actor', namesOnly: true })
    ]);
    if (directorsResult.success && directorsResult.data) {
      availableDirectors.value = directorsResult.data.map(d => d.name).filter(Boolean);
    }
    if (studiosResult.success && studiosResult.data) {
      availableStudios.value = studiosResult.data.map(s => s.name).filter(Boolean);
    }
    if (genresResult.success && genresResult.data) {
      availableGenres.value = genresResult.data.map(g => g.name).filter(Boolean);
    }
    if (actorsResult.success && actorsResult.data) {
      availableActors.value = actorsResult.data.map(a => a.name).filter(Boolean);
    }
    if (directorsResult.success || studiosResult.success || genresResult.success || actorsResult.success) {
      lastRefreshedDataVersion.value = scanStore.dataVersion;
    }
  } catch (error) {
    console.error('加载选项列表失败:', error);
  }
};

onActivated(() => {
  if (scanStore.dataVersion > lastRefreshedDataVersion.value) {
    lastRefreshedDataVersion.value = scanStore.dataVersion;
    loadOptions();
  }
});

/** 执行简易搜索并更新下方结果区 */
async function runSimpleSearch(keyword) {
  const k = (keyword || '').trim();
  if (!k) {
    simpleResults.value = [];
    simpleTotal.value = 0;
    return;
  }
  try {
    simpleLoading.value = true;
    const result = await window.electronAPI.search.simple(k, {
      page: 1,
      pageSize: SIMPLE_PAGE_SIZE,
      sortBy: listParams.sortBy
    });
    if (result.success) {
      simpleResults.value = result.data || [];
      simpleTotal.value = result.total ?? 0;
      loadImagesBatch(simpleResults.value, simpleImageCache.value, 12);
      const map = {};
      await Promise.all(
        (simpleResults.value || []).map(async (m) => {
          if (!m?.code) return;
          try {
            const res = await window.electronAPI.favorites.getFoldersContainingMovie(m.code);
            if (res?.success && Array.isArray(res.data)) map[m.code] = res.data;
          } catch (_) {}
        })
      );
      simpleFavoriteFolderIdsByCode.value = { ...simpleFavoriteFolderIdsByCode.value, ...map };
    } else {
      simpleResults.value = [];
      simpleTotal.value = 0;
    }
  } catch (error) {
    console.error('简易搜索失败:', error);
    simpleResults.value = [];
    simpleTotal.value = 0;
  } finally {
    simpleLoading.value = false;
  }
}

watch(
  () => simpleForm.value.keyword,
  (val) => {
    if (simpleDebounceTimer.value) {
      clearTimeout(simpleDebounceTimer.value);
      simpleDebounceTimer.value = null;
    }
    const k = (val || '').trim();
    if (!k) {
      simpleResults.value = [];
      simpleTotal.value = 0;
      return;
    }
    simpleDebounceTimer.value = setTimeout(() => {
      simpleDebounceTimer.value = null;
      runSimpleSearch(k);
    }, DEBOUNCE_MS);
  }
);

onBeforeUnmount(() => {
  if (simpleDebounceTimer.value) {
    clearTimeout(simpleDebounceTimer.value);
    simpleDebounceTimer.value = null;
  }
});

/** 回车或点击搜索按钮：按原逻辑跳转（0 条提示、1 条进详情、多条进搜索列表页） */
const handleSimpleSearch = async () => {
  const k = simpleForm.value.keyword?.trim() || '';
  if (!k) {
    ElMessage.warning('请输入搜索关键词');
    return;
  }
  try {
    searching.value = true;
    const result = await window.electronAPI.search.simple(k, { page: 1, pageSize: 1, sortBy: 'premiered-desc' });
    if (result.success) {
      const total = result.total ?? 0;
      if (total === 0) {
        ElMessage.info('未找到匹配的影片');
      } else if (total === 1) {
        const first = result.data?.[0];
        if (first?.id) router.push(`/movie/${first.id}`);
        else ElMessage.info('未找到匹配的影片');
      } else {
        router.push({
          path: '/search/results',
          query: { type: 'simple', keyword: k, total }
        });
      }
    } else {
      ElMessage.error('搜索失败: ' + (result.message || '未知错误'));
    }
  } catch (error) {
    console.error('搜索失败:', error);
    ElMessage.error('搜索失败: ' + error.message);
  } finally {
    searching.value = false;
  }
};

function isSimpleFavorited(movie) {
  if (!movie?.code) return false;
  const ids = simpleFavoriteFolderIdsByCode.value[movie.code];
  return Array.isArray(ids) && ids.length > 0;
}

function loadMovieImage(movie) {
  if (!movie?.poster_path) return;
  loadImage(movie.poster_path, movie.data_path_index ?? 0, false, simpleImageCache.value);
}

function goToMovieDetail(movie) {
  if (!movie?.id) return;
  router.push({ path: `/movie/${movie.id}` });
}

async function onPlayVideo(movie) {
  if (!movie?.id) return;
  try {
    ElMessage.info('正在打开播放器...');
    const result = await window.electronAPI.movie.playVideo(movie.id);
    if (result?.success) ElMessage.success('已使用系统默认播放器打开视频');
    else ElMessage.error(result?.message || '播放失败');
  } catch (e) {
    ElMessage.error('播放失败: ' + (e?.message || ''));
  }
}

function onToggleFavorite(movie) {
  favoriteDialogMovie.value = movie;
  favoriteDialogVisible.value = true;
}

async function onFavoriteDialogDone() {
  const movie = favoriteDialogMovie.value;
  if (movie?.code) {
    try {
      const res = await window.electronAPI.favorites.getFoldersContainingMovie(movie.code);
      if (res?.success && Array.isArray(res.data)) {
        simpleFavoriteFolderIdsByCode.value = {
          ...simpleFavoriteFolderIdsByCode.value,
          [movie.code]: res.data
        };
      }
    } catch (_) {}
  }
}

function goToSearchResults() {
  const k = simpleForm.value.keyword?.trim() || '';
  if (!k) return;
  router.push({
    path: '/search/results',
    query: { type: 'simple', keyword: k }
  });
}

const handleAdvancedSearch = async () => {
  // 检查是否至少填写了一个参数
  const hasTitle = advancedForm.value.title && advancedForm.value.title.trim() !== '';
  const hasDateRange = advancedForm.value.dateRange && Array.isArray(advancedForm.value.dateRange) && advancedForm.value.dateRange.length === 2;
  const hasDirector = advancedForm.value.director && advancedForm.value.director.trim() !== '';
  const hasStudio = advancedForm.value.studio && advancedForm.value.studio.trim() !== '';
  const hasGenre = advancedForm.value.genre && advancedForm.value.genre.trim() !== '';
  const hasActor = advancedForm.value.actor && advancedForm.value.actor.trim() !== '';
  
  if (!hasTitle && !hasDateRange && !hasDirector && !hasStudio && !hasGenre && !hasActor) {
    ElMessage.warning('请至少填写一个搜索条件');
    return;
  }
  
  try {
    searching.value = true;
    
    const params = {};
    if (hasTitle) {
      params.title = advancedForm.value.title.trim();
    }
    if (hasDateRange) {
      params.dateFrom = advancedForm.value.dateRange[0];
      params.dateTo = advancedForm.value.dateRange[1];
    }
    if (hasDirector) {
      params.director = advancedForm.value.director.trim();
    }
    if (hasStudio) {
      params.studio = advancedForm.value.studio.trim();
    }
    if (hasGenre) {
      params.genre = advancedForm.value.genre.trim();
    }
    if (hasActor) {
      params.actor = advancedForm.value.actor.trim();
    }
    
    const result = await window.electronAPI.search.advanced(params);
    
    if (result.success) {
      if (result.total === 0) {
        ElMessage.info('未找到匹配的影片');
      } else if (result.total === 1) {
        // 单项结果，跳转到详情页
        router.push(`/movie/${result.data[0].id}`);
      } else {
        // 多项结果，跳转到搜索结果列表页
        router.push({
          path: '/search/results',
          query: {
            type: 'advanced',
            ...params,
            total: result.total
          }
        });
      }
    } else {
      ElMessage.error('搜索失败: ' + (result.message || '未知错误'));
    }
  } catch (error) {
    console.error('搜索失败:', error);
    ElMessage.error('搜索失败: ' + error.message);
  } finally {
    searching.value = false;
  }
};

const resetAdvancedForm = () => {
  advancedForm.value = {
    title: '',
    dateRange: null,
    director: '',
    studio: '',
    genre: '',
    actor: ''
  };
};

onMounted(() => {
  loadOptions();
});
</script>

<style scoped>
.search {
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
.page-header {
  background-color: var(--header-bg);
  color: var(--title-color);
  display: flex;
  align-items: center;
  padding: 0 20px;
}

.el-main {
  padding: 20px;
}

:deep(.el-tabs__content) {
  padding: 20px 0;
}

:deep(.el-form-item) {
  margin-bottom: 20px;
}

/* 多重搜索发行日期选择器固定宽度，与表单项左对齐 */
.search :deep(.advanced-date-picker) {
  width: 400px !important;
  max-width: 400px;
}
.search :deep(.advanced-date-picker .el-input__wrapper) {
  min-width: 0;
}

/* 简易搜索结果区：仅卡片网格 + 共 N 条 + 查看全部，网格最多两行 */
.simple-result-area {
  margin-top: 16px;
  min-height: 80px;
}
.simple-result-placeholder,
.simple-result-loading,
.simple-result-empty {
  color: var(--el-text-color-secondary);
  padding: 24px 0;
  text-align: center;
}
.simple-result-total {
  margin: 0 0 12px 0;
  font-size: 14px;
  color: var(--el-text-color-regular);
}
.simple-result-grid-wrap {
  width: 100%;
}
/* 不设 max-height，仅通过 simpleDisplayedResults 限制为 2 行，避免窗口缩小时卡片变大导致底部被裁切 */
.simple-result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 16px;
  padding: 8px 0 8px 0;
}
.simple-result-grid .movie-card {
  cursor: pointer;
  transition: transform 0.2s;
}
.simple-result-grid .movie-card:hover {
  transform: translateY(-4px);
}
.simple-result-grid .movie-poster {
  position: relative;
  width: 100%;
  aspect-ratio: 0.7;
  max-height: 300px;
  overflow: hidden;
  background-color: var(--el-fill-color-light);
}
.simple-result-grid .play-icon {
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
  cursor: pointer;
}
.simple-result-grid .favorite-icon {
  position: absolute;
  bottom: 8px;
  right: 8px;
  width: 30px;
  height: 30px;
  background-color: rgba(0, 0, 0, 0.6);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  cursor: pointer;
  color: #fff;
}
.simple-result-grid .favorite-icon.is-favorited {
  color: #f56c6c;
}
.simple-result-grid .image-slot {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-placeholder);
  font-size: 14px;
}
.simple-result-grid .movie-info {
  padding: 12px;
  text-align: center;
}
.simple-result-grid .movie-title {
  font-size: 14px;
  font-weight: bold;
  margin-bottom: 4px;
  color: var(--movie-title-color, var(--el-text-color-primary));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.simple-result-grid .movie-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.simple-result-actions {
  margin-top: 12px;
}
</style>
