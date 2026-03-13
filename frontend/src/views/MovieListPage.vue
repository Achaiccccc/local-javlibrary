<template>
  <div class="movie-list-page">
    <el-container>
      <el-header class="page-header">
        <div class="header-content">
          <div class="header-left" :class="{ 'no-back': listType === 'home' }">
            <el-button v-if="listType !== 'home'" @click="goBack" icon="ArrowLeft">返回</el-button>
            <h1 class="header-title">{{ headerTitle }}</h1>
          </div>
          <ThemeSwitch />
        </div>
      </el-header>
      <el-main ref="mainContentRef" class="page-theme-bg">
        <div v-if="showActorHeaderBlock" class="actor-header-block">
          <div class="actor-avatar-wrap" @click="actorAvatar?.hasAvatar ? openAvatarPreview() : null">
            <template v-if="actorAvatar?.hasAvatar">
              <el-image
                :src="actorAvatar.url"
                fit="contain"
                class="actor-avatar-image"
              >
                <template #error>
                  <div class="actor-avatar-slot">加载失败</div>
                </template>
              </el-image>
              <div class="actor-avatar-zoom-mask" title="点击放大查看">
                <el-icon class="actor-avatar-zoom-icon"><ZoomIn /></el-icon>
              </div>
              <el-icon
                v-if="actorAvatar.hasMultiple"
                class="actor-avatar-edit-icon"
                @click.stop="openAvatarPicker(actorCanonicalName)"
              >
                <Edit />
              </el-icon>
            </template>
            <div v-else class="actor-avatar-slot">暂无头像</div>
          </div>
          <div class="actor-header-info">
            <div class="actor-header-name-row">
              <span class="actor-header-name">{{ actorDisplayName }}</span>
              <el-icon class="actor-name-edit-icon" title="编辑名称与曾用名" @click="openActorProfileEdit">
                <Edit />
              </el-icon>
            </div>
            <div v-if="actorFormerNamesDisplay" class="actor-header-former-names">{{ actorFormerNamesDisplay }}</div>
          </div>
        </div>
        <div class="filter-bar" v-if="listType !== 'favorite' && filterGroupList && filterGroupList.length">
          <div
            v-for="group in visibleFilterGroups"
            :key="group.key"
            class="filter-group"
          >
            <div class="filter-group-row">
              <span class="filter-group-label">{{ group.label }}：</span>
              <div class="filter-group-tags-wrap">
                <div
                  class="filter-group-tags"
                  :class="{ 'is-collapsed': !expandedGroups[group.key] }"
                  :ref="el => setGroupTagsRef(group.key, el)"
                >
                  <el-check-tag
                    v-for="opt in group.options"
                    :key="opt.value"
                    :checked="(selectedValues[group.key] || []).includes(opt.value)"
                    @click="handleTagClick(group, opt)"
                    class="filter-tag"
                  >
                    {{ opt.label }}
                  </el-check-tag>
                </div>
              </div>
              <el-button
                v-if="canCollapse(group.key)"
                size="small"
                class="filter-toggle"
                @click="toggleGroupExpand(group.key)"
              >
                <span>{{ expandedGroups[group.key] ? '收起' : '展开' }}</span>
                <el-icon class="filter-toggle-icon">
                  <ArrowUp v-if="expandedGroups[group.key]" />
                  <ArrowDown v-else />
                </el-icon>
              </el-button>
            </div>
          </div>
          <div class="filter-collapse-toggle">
            <el-button
              size="small"
              class="filter-collapse-button"
              @click="toggleFilterCollapse"
            >
              <span>{{ filterCollapsed ? '展开分类' : '收起分类' }}</span>
              <el-icon class="filter-toggle-icon">
                <ArrowDown v-if="filterCollapsed" />
                <ArrowUp v-else />
              </el-icon>
            </el-button>
          </div>
        </div>
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
          :route-version="routeVersion"
          @update:pageSize="handlePageSizeChange"
          @update:currentPage="handlePageChange"
          @update:sortBy="handleSortByChange"
          @update:viewMode="handleViewModeChange"
          @rowClick="goToMovieDetail"
          @playVideo="onPlayVideo"
          @toggleFavorite="onToggleFavorite"
          :load-movie-image="movie => loadMovieImage(movie.poster_path, movie.data_path_index)"
          :show-favorite-heart="true"
          :favorite-folder-ids-by-code="favoriteFolderIdsByCode"
        >
          <template #before-view-mode>
            <div class="lottery-entry">
              <div class="lottery-hint-row">
                <span class="lottery-hint">不知道看什么了？试试随机抽奖吧</span>
                <el-tooltip content="从库中随机选取18条数据然后抽取3条" placement="top">
                  <span class="lottery-hint-icon-wrap">
                    <el-icon><QuestionFilled /></el-icon>
                  </span>
                </el-tooltip>
              </div>
              <el-button type="primary" size="small" class="lottery-btn" @click="openSlotDialog">开始抽奖</el-button>
            </div>
          </template>
          <template v-if="listType === 'search'" #left-extra>
            <span style="margin-left: 16px; color: #909399;">共找到 {{ total }} 条结果</span>
          </template>
        </MovieListLayout>
        <SlotMachineDialog v-model="slotDialogVisible" />
        <FavoriteFoldersDialog
          v-model="favoriteDialogVisible"
          :movie="favoriteDialogMovie"
          @done="onFavoriteDialogDone"
        />
        <ActorAvatarPickerDialog
          v-model="avatarPickerVisible"
          :actor-name="avatarPickerActorName"
          @done="onAvatarPickerDone"
        />
        <el-dialog
          v-model="actorProfileEditVisible"
          title="编辑演员名称与曾用名"
          width="480px"
          class="actor-profile-edit-dialog"
          destroy-on-close
          @closed="onActorProfileEditClosed"
        >
          <el-form label-width="100px" label-position="left">
            <el-form-item label="显示名称">
              <el-input v-model="editDisplayName" placeholder="留空则显示 NFO 中的原名" clearable />
            </el-form-item>
            <el-form-item label="曾用名">
              <div class="former-names-list">
                <div v-for="(item, idx) in editFormerNames" :key="idx" class="former-name-row">
                  <el-input v-model="editFormerNames[idx]" placeholder="曾用名" clearable />
                  <el-button type="danger" link @click="removeFormerName(idx)">删除</el-button>
                </div>
                <el-button type="primary" link @click="addFormerName">+ 添加曾用名</el-button>
              </div>
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="actorProfileEditVisible = false">取消</el-button>
            <el-button type="primary" @click="saveActorProfile">保存</el-button>
          </template>
        </el-dialog>
        <Teleport to="body">
          <div
            v-show="avatarPreviewVisible"
            class="avatar-preview-mask"
            @click.self="closeAvatarPreview"
          >
            <img
              v-if="avatarPreviewUrls.length"
              class="avatar-preview-img"
              :src="avatarPreviewUrls[avatarPreviewIndex] || ''"
              alt=""
              @click.stop
            />
            <div class="avatar-preview-pagination">
              {{ avatarPreviewIndex + 1 }}/{{ avatarPreviewUrls.length }}
            </div>
            <button
              v-if="avatarPreviewUrls.length > 1"
              type="button"
              class="avatar-preview-btn avatar-preview-prev"
              aria-label="上一张"
              @click.stop="prevAvatarPreview"
            >
              ‹
            </button>
            <button
              v-if="avatarPreviewUrls.length > 1"
              type="button"
              class="avatar-preview-btn avatar-preview-next"
              aria-label="下一张"
              @click.stop="nextAvatarPreview"
            >
              ›
            </button>
            <button
              type="button"
              class="avatar-preview-close"
              aria-label="关闭"
              @click.stop="closeAvatarPreview"
            >
              ×
            </button>
          </div>
        </Teleport>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
defineOptions({ name: 'MovieListPage' });
import { ref, computed, onMounted, onBeforeUnmount, onActivated, onDeactivated, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowDown, ArrowUp, QuestionFilled, Edit, ZoomIn } from '@element-plus/icons-vue';
import MovieListLayout from '../components/MovieListLayout.vue';
import ActorAvatarPickerDialog from '../components/ActorAvatarPickerDialog.vue';
import SlotMachineDialog from '../components/SlotMachineDialog.vue';
import FavoriteFoldersDialog from '../components/FavoriteFoldersDialog.vue';
import ThemeSwitch from '../components/ThemeSwitch.vue';
import { useListParamsStore } from '../stores/listParamsStore';
import { useScanStore } from '../stores/scanStore';
import { savePageState, getPageState, saveScrollPosition, restoreScrollPosition, clearScrollPosition } from '../utils/pageState';
import { loadImagesBatch, pauseBackgroundLoading, resumeBackgroundLoading, loadImage } from '../utils/imageLoader';
import { withLoadingOptimization } from '../utils/loadingOptimizer';
import { buildFilterGroups } from '../config/genres';
import { useGenreCategoriesStore } from '../stores/genreCategoriesStore';

const router = useRouter();
const route = useRoute();
const listParams = useListParamsStore();
const genreStore = useGenreCategoriesStore();
const scanStore = useScanStore();
const lastRefreshedDataVersion = ref(0);
const lastScrollTop = ref(0);
const scrollCleanupRef = ref(null);

const loading = ref(true);
const movies = ref([]);
const total = ref(0);
const imageCache = ref({});
/** 初始加载是否已结束（成功或非 DB_NOT_READY 的失败）；未结束时 database:ready / 轮询会再次触发加载 */
const initialLoadDone = ref(false);
const loadInProgress = ref(false);
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
  if (path.startsWith('/favorite/')) return 'favorite';
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
    case 'favorite': return 'favorite_' + (route.params.id ?? '');
    default: return 'home';
  }
});

const headerTitle = computed(() => {
  switch (listType.value) {
    case 'home': return 'JavLibrary - 本地影视库';
    case 'actor': return (viewModeFromQuery.value === 'actor' ? actorDisplayName.value : null) || actorName.value || (viewModeFromQuery.value === 'folder' ? '文件目录详情' : '演员详情');
    case 'genre': return genreName.value || '分类详情';
    case 'director': return directorName.value || '导演详情';
    case 'studio': return studioName.value || '制作商详情';
    case 'series': return '系列：' + (route.params.prefix ?? '');
    case 'search': return '搜索结果';
    case 'favorite': return favoriteFolderName.value || '收藏夹';
    default: return '影片列表';
  }
});

const actorName = ref('');
const actorAvatar = ref(null);
const actorProfile = ref(null);
const actorDataPathConfigured = ref(false);
const avatarPreviewVisible = ref(false);
const avatarPreviewUrls = ref([]);
const avatarPreviewIndex = ref(0);
const genreName = ref('');
const directorName = ref('');
const studioName = ref('');
const favoriteFolderName = ref('');
const favoriteFolderIdsByCode = ref({});
const favoriteDialogVisible = ref(false);
const favoriteDialogMovie = ref(null);
const avatarPickerVisible = ref(false);
const avatarPickerActorName = ref('');
const actorProfileEditVisible = ref(false);
const viewModeFromQuery = computed(() => route.query.viewMode || (typeof route.params.id === 'string' && isNaN(parseInt(route.params.id)) ? 'folder' : 'actor'));

const showActorHeaderBlock = computed(() =>
  listType.value === 'actor' && viewModeFromQuery.value === 'actor' && actorDataPathConfigured.value
);
const actorDisplayName = computed(() =>
  (actorProfile.value?.display_name && actorProfile.value.display_name.trim()) ? actorProfile.value.display_name.trim() : (actorProfile.value?.name || actorName.value || '')
);
const actorFormerNamesDisplay = computed(() => {
  const arr = actorProfile.value?.former_names;
  if (!Array.isArray(arr) || arr.length === 0) return '';
  return arr.filter(n => typeof n === 'string' && n.trim()).join('、');
});
const actorCanonicalName = computed(() => actorProfile.value?.name || actorName.value || '');

const emptyText = computed(() => (listType.value === 'search' ? '未找到匹配的影片' : '暂无影片数据'));
const showPagination = computed(() => {
  if (listType.value === 'search') return total.value > listParams.pageSize;
  return true;
});

const currentPage = ref(1);
const slotDialogVisible = ref(false);
const routeVersion = ref(0);

function openSlotDialog() {
  slotDialogVisible.value = true;
}

const editDisplayName = ref('');
const editFormerNames = ref([]);

function openActorProfileEdit() {
  if (!actorProfile.value || viewModeFromQuery.value !== 'actor') return;
  editDisplayName.value = (actorProfile.value.display_name && actorProfile.value.display_name.trim())
    ? actorProfile.value.display_name.trim()
    : (actorProfile.value.name || '');
  editFormerNames.value = Array.isArray(actorProfile.value.former_names) ? [...actorProfile.value.former_names] : [];
  actorProfileEditVisible.value = true;
}

function addFormerName() {
  editFormerNames.value.push('');
}

function removeFormerName(idx) {
  editFormerNames.value.splice(idx, 1);
}

function onActorProfileEditClosed() {
  editDisplayName.value = '';
  editFormerNames.value = [];
}

async function saveActorProfile() {
  const id = actorProfile.value?.id;
  if (id == null || isNaN(Number(id))) return;
  const displayName = typeof editDisplayName.value === 'string' ? editDisplayName.value.trim() : '';
  // 去重并清洗曾用名
  const formerNamesArr = editFormerNames.value
    .map(n => (typeof n === 'string' ? n.trim() : ''))
    .filter(Boolean);
  const formerNames = Array.from(new Set(formerNamesArr));

  // 显示名不能与曾用名重复
  if (displayName && formerNames.includes(displayName)) {
    ElMessage.error('显示名称不能与曾用名重复，请修改后再保存');
    return;
  }
  try {
    console.debug('[ActorProfile] saveActorProfile start', {
      id,
      displayName,
      formerNames
    });
    // 先检查名称/曾用名是否与其他演员产生冲突
    const check = await window.electronAPI.actors.checkProfileConflict?.(id, {
      displayName: displayName || null,
      formerNames
    });
    console.debug('[ActorProfile] checkProfileConflict result', check);
    let needMerge = false;
    let mergeTargetId = null;
    if (check?.success && check.hasConflict && check.conflict?.actorId && check.conflict?.name) {
      const targetId = check.conflict.actorId;
      const name = check.conflict.name;
      const otherDisplayName = (check.conflict.actorDisplayName && String(check.conflict.actorDisplayName).trim()) || '';
      const otherFormerNames = Array.isArray(check.conflict.actorFormerNames)
        ? check.conflict.actorFormerNames.filter(n => typeof n === 'string' && n.trim())
        : [];
      const otherLabel = otherDisplayName || '未知演员';
      const formerLabel = otherFormerNames.length ? `（曾用名：${otherFormerNames.join('、')}）` : '';
      const confirmMsg =
        `名称「${name}」与演员「${otherLabel}」${formerLabel}的名称或曾用名存在冲突。\n\n` +
        `是否将当前演员与该演员合并为同一人？`;
      try {
        await ElMessageBox.confirm(confirmMsg, '合并演员确认', {
          confirmButtonText: '合并',
          cancelButtonText: '不合并',
          type: 'warning'
        });
        needMerge = true;
        mergeTargetId = targetId;
        console.debug('[ActorProfile] user chose MERGE', { mergeTargetId });
      } catch {
        needMerge = false;
        console.debug('[ActorProfile] user chose NOT MERGE');
      }
    }

    // 先保存当前演员的显示名与曾用名
    const res = await window.electronAPI.actors.updateProfile(id, { displayName: displayName || null, formerNames });
    if (!res?.success) {
      ElMessage.error(res?.message || '保存失败');
      return;
    }

    actorProfile.value = {
      ...actorProfile.value,
      display_name: displayName || null,
      former_names: formerNames
    };

    // 通知目录页等使用处刷新演员列表
    try {
      window.dispatchEvent(new CustomEvent('actorProfileChanged', { detail: { actorId: id } }));
    } catch (_) {}

    // 如需合并，则按「保留更早存在的那条」的规则执行软合并
    if (needMerge && mergeTargetId != null && mergeTargetId !== id) {
      const target = Number(mergeTargetId);
      const self = Number(id);
      const targetIdForMerge = Math.min(target, self);
      const sourceIdForMerge = Math.max(target, self);
      console.debug('[ActorProfile] call actors.merge', {
        targetIdForMerge,
        sourceIdForMerge
      });
      const mergeRes = await window.electronAPI.actors.merge?.(targetIdForMerge, sourceIdForMerge);
      console.debug('[ActorProfile] merge result', mergeRes);
      if (!mergeRes?.success) {
        ElMessage.error(mergeRes?.message || '合并演员失败');
      } else {
        ElMessage.success('已合并演员数据');
      }
    }

    actorProfileEditVisible.value = false;
    ElMessage.success('已保存');
  } catch (e) {
    console.error('[ActorProfile] saveActorProfile error', e);
    ElMessage.error(e?.message || '保存失败');
  }
}

function openAvatarPicker(name) {
  avatarPickerActorName.value = name || actorCanonicalName.value || actorName.value || '';
  avatarPickerVisible.value = true;
}

function onAvatarPickerDone() {
  const name = actorCanonicalName.value || actorName.value;
  if (!name || listType.value !== 'actor') return;
  window.electronAPI?.actorAvatars?.getSummaryByName?.(name)?.then((res) => {
    if (res?.success && res?.data) {
      actorAvatar.value = res.data;
      window.dispatchEvent(new CustomEvent('actorAvatarChanged', { detail: { name } }));
    }
  }).catch(() => {});
}

async function openAvatarPreview() {
  const name = actorCanonicalName.value || actorName.value;
  if (!name) return;
  try {
    const res = await window.electronAPI?.actorAvatars?.getCandidatesByName?.(name);
    const list = (res?.success && Array.isArray(res.data?.candidates)) ? res.data.candidates : [];
    const urls = list.map(c => c.url).filter(Boolean);
    const currentUrl = actorAvatar.value?.url;
    if (!urls.length && currentUrl) {
      avatarPreviewUrls.value = [currentUrl];
      avatarPreviewIndex.value = 0;
    } else if (urls.length) {
      avatarPreviewUrls.value = urls;
      // 从当前展示的头像开始：优先用 selectedId 定位，否则用 URL 匹配
      const selectedId = res?.data?.selectedId;
      let idx = 0;
      if (selectedId != null) {
        const i = list.findIndex(c => c.id === selectedId);
        if (i >= 0) idx = i;
      } else if (currentUrl) {
        const i = urls.indexOf(currentUrl);
        if (i >= 0) idx = i;
      }
      avatarPreviewIndex.value = idx;
    } else {
      avatarPreviewUrls.value = [];
      avatarPreviewIndex.value = 0;
    }
    if (avatarPreviewUrls.value.length) {
      avatarPreviewVisible.value = true;
    }
  } catch (e) {
    console.error('openAvatarPreview error:', e);
  }
}

function closeAvatarPreview() {
  avatarPreviewVisible.value = false;
}

function prevAvatarPreview() {
  if (!avatarPreviewUrls.value.length) return;
  avatarPreviewIndex.value =
    (avatarPreviewIndex.value - 1 + avatarPreviewUrls.value.length) % avatarPreviewUrls.value.length;
}

function nextAvatarPreview() {
  if (!avatarPreviewUrls.value.length) return;
  avatarPreviewIndex.value = (avatarPreviewIndex.value + 1) % avatarPreviewUrls.value.length;
}

// 顶部筛选器状态
const filterGroupList = ref([]);
const selectedValues = ref({});
const expandedGroups = ref({});
const groupTagHeights = ref({});
const filterCollapsed = ref(true);

function initFilterState() {
  const state = {};
  const expanded = {};
  filterGroupList.value.forEach(group => {
    const opts = group.options || [];
    const hasAll = opts.find(o => o.value === 'all');
    state[group.key] = hasAll ? ['all'] : [];
    expanded[group.key] = false;
  });
  selectedValues.value = state;
  expandedGroups.value = expanded;
}

watch(
  () => genreStore.categories,
  (cats) => {
    filterGroupList.value = buildFilterGroups(cats);
    initFilterState();
  },
  { deep: true, immediate: true }
);

onMounted(() => {
  // 确保应用启动或刷新后，先加载分类配置，再驱动顶部筛选器分组
  genreStore.load();
});

const visibleFilterGroups = computed(() => {
  if (!filterCollapsed.value) return filterGroupList.value;
  return filterGroupList.value.filter(g => g.type === 'type' || g.type === 'year');
});

const selectedGenreNames = computed(() => {
  const result = new Set();
  filterGroupList.value.forEach(group => {
    if (group.type !== 'genre') return;
    const values = selectedValues.value[group.key] || [];
    const hasReal = values.some(v => v !== 'all');
    if (!hasReal) return;
    values.forEach(v => {
      if (v !== 'all') {
        result.add(v);
      }
    });
  });
  return Array.from(result);
});

const selectedYears = computed(() => {
  const yearGroup = filterGroupList.value.find(g => g.type === 'year');
  if (!yearGroup) return [];
  const values = selectedValues.value[yearGroup.key] || [];
  const hasReal = values.some(v => v !== 'all');
  if (!hasReal) return [];
  return values.filter(v => v !== 'all');
});

function setGroupTagsRef(key, el) {
  if (el) {
    groupTagHeights.value[key] = el.scrollHeight || 0;
  }
}

function canCollapse(key) {
  const h = groupTagHeights.value[key] || 0;
  return h > 32;
}

function toggleGroupExpand(key) {
  expandedGroups.value[key] = !expandedGroups.value[key];
}

function toggleFilterCollapse() {
  filterCollapsed.value = !filterCollapsed.value;
}

function handleTagClick(group, option) {
  const key = group.key;
  const value = option.value;
  const current = selectedValues.value[key] ? [...selectedValues.value[key]] : [];

  if (value === 'all') {
    selectedValues.value[key] = ['all'];
  } else {
    const index = current.indexOf(value);
    if (index >= 0) {
      current.splice(index, 1);
    } else {
      current.push(value);
    }
    if (current.length === 0) {
      const hasAll = (group.options || []).some(o => o.value === 'all');
      selectedValues.value[key] = hasAll ? ['all'] : [];
    } else {
      selectedValues.value[key] = current.filter(v => v !== 'all');
    }
  }

  if (group.type !== 'type') {
    currentPage.value = 1;
    savePageState(pageKey.value, { currentPage: 1 });
    clearScrollPosition(pageKey.value);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadData();
  }
}

function syncCurrentPageFromState() {
  currentPage.value = getPageState(pageKey.value, { currentPage: 1 }).currentPage ?? 1;
}

const loadDataRaw = async () => {
  loading.value = true;
  const page = currentPage.value;
  const pageSize = listParams.pageSize;
  const sortBy = listParams.sortBy;
  const filterGenres = selectedGenreNames.value;
  const filterYears = selectedYears.value;
  let result = { success: false, data: [], total: 0 };

  try {
    if (listType.value !== 'actor') {
      actorAvatar.value = null;
      actorProfile.value = null;
    }
    switch (listType.value) {
      case 'home': {
        result = await window.electronAPI.movies.getList({ page, pageSize, sortBy, filterGenres, filterYears });
        break;
      }
      case 'actor': {
        const id = viewModeFromQuery.value === 'folder' ? decodeURIComponent(route.params.id) : parseInt(route.params.id);
        if (id == null || (viewModeFromQuery.value === 'actor' && isNaN(id))) {
          ElMessage.error('无效的演员ID');
          loading.value = false;
          initialLoadDone.value = true;
          return;
        }
        result = await window.electronAPI.actors.getMovies(id, { page, pageSize, sortBy, viewMode: viewModeFromQuery.value, filterGenres, filterYears });
        try {
          const path = await window.electronAPI.settings.getActorDataPath();
          actorDataPathConfigured.value = !!path;
        } catch (_) {
          actorDataPathConfigured.value = false;
        }
        if (result.success && result.actor?.name) {
          actorName.value = result.actor.name;
          actorAvatar.value = result.actor.avatar || null;
          if (viewModeFromQuery.value === 'actor') {
            actorProfile.value = {
              id: result.actor.id,
              name: result.actor.name,
              display_name: result.actor.display_name ?? null,
              former_names: Array.isArray(result.actor.former_names) ? result.actor.former_names : []
            };
          } else {
            actorProfile.value = null;
          }
        } else {
          actorAvatar.value = null;
          actorProfile.value = null;
          if (viewModeFromQuery.value === 'folder' && id) actorName.value = String(id);
          else if (result.success && viewModeFromQuery.value === 'actor' && !isNaN(id)) {
            try {
              const ar = await window.electronAPI.actors.getById(id, { viewMode: viewModeFromQuery.value });
              if (ar?.success && ar?.data?.name) {
                actorName.value = ar.data.name;
                actorProfile.value = {
                  id: ar.data.id,
                  name: ar.data.name,
                  display_name: ar.data.display_name ?? null,
                  former_names: Array.isArray(ar.data.former_names) ? ar.data.former_names : []
                };
              } else {
                actorName.value = '演员 ' + id;
                actorProfile.value = null;
              }
            } catch (_) {
              actorName.value = '演员 ' + id;
              actorProfile.value = null;
            }
          }
        }
        break;
      }
      case 'genre': {
        const genreId = parseInt(route.params.id);
        result = await window.electronAPI.movies.getList({ page, pageSize, sortBy, genreId, filterGenres, filterYears });
        if (result.success && result.data?.length && result.data[0].genres) {
          const g = result.data[0].genres.find(x => x.id === genreId);
          if (g) genreName.value = g.name;
        }
        break;
      }
      case 'director': {
        const directorId = parseInt(route.params.id);
        result = await window.electronAPI.directors.getMovies(directorId, { page, pageSize, sortBy, filterGenres, filterYears });
        if (result.success && result.director?.name) directorName.value = result.director.name;
        else if (result.success && directorId) directorName.value = '导演 ' + directorId;
        break;
      }
      case 'studio': {
        const studioId = parseInt(route.params.id);
        result = await window.electronAPI.studios.getMovies(studioId, { page, pageSize, sortBy, filterGenres, filterYears });
        if (result.success && result.studio?.name) studioName.value = result.studio.name;
        else if (result.success && studioId) studioName.value = '制作商 ' + studioId;
        break;
      }
      case 'series': {
        const prefix = route.params.prefix;
        result = await window.electronAPI.movies.getSeries(prefix, { page, pageSize, sortBy, filterGenres, filterYears });
        break;
      }
      case 'favorite': {
        const folderId = route.params.id;
        if (!folderId) {
          ElMessage.error('无效的收藏夹');
          loading.value = false;
          return;
        }
        result = await window.electronAPI.favorites.getMoviesByFolder(folderId, { page, pageSize, sortBy });
        if (result.success) {
          const foldersRes = await window.electronAPI.favorites.getFolders();
          if (foldersRes?.success && Array.isArray(foldersRes.data)) {
            const folder = foldersRes.data.find(f => f.id === folderId);
            favoriteFolderName.value = folder?.name || '收藏夹';
          }
        }
        break;
      }
      case 'search': {
        const q = route.query;
        if (q.type === 'simple') {
          result = await window.electronAPI.search.simple(q.keyword || '', { page, pageSize, sortBy, filterGenres, filterYears });
        } else if (q.type === 'advanced') {
          const params = { page, pageSize, sortBy };
          if (q.title) params.title = q.title;
          if (q.dateFrom) params.dateFrom = q.dateFrom;
          if (q.dateTo) params.dateTo = q.dateTo;
          if (q.director) params.director = q.director;
          if (q.studio) params.studio = q.studio;
          if (q.genre) params.genre = q.genre;
          if (q.actor) params.actor = q.actor;
          params.filterGenres = filterGenres;
          params.filterYears = filterYears;
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
    initialLoadDone.value = true;
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
    initialLoadDone.value = true;
    return;
  }
  initialLoadDone.value = true;

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
  lastRefreshedDataVersion.value = scanStore.dataVersion;
  loading.value = false;

  if (movies.value.length > 0) {
    const map = {};
    await Promise.all(
      movies.value.map(async (m) => {
        if (!m?.code) return;
        try {
          const res = await window.electronAPI.favorites.getFoldersContainingMovie(m.code);
          if (res?.success && Array.isArray(res.data)) map[m.code] = res.data;
        } catch (_) {}
      })
    );
    favoriteFolderIdsByCode.value = { ...favoriteFolderIdsByCode.value, ...map };
  }
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
  if (scrollCleanupRef.value) {
    scrollCleanupRef.value();
    scrollCleanupRef.value = null;
  }
  savePageState(pageKey.value, { currentPage: currentPage.value });
  saveScrollPosition(pageKey.value, lastScrollTop.value);
  router.push({ path: `/movie/${id}` });
}

async function onPlayVideo(movie) {
  if (!movie?.id) return;
  try {
    pauseBackgroundLoading();
    ElMessage.info('正在打开播放器...');
    const result = await window.electronAPI.movie.playVideo(movie.id);
    if (result?.success) ElMessage.success('已使用系统默认播放器打开视频');
    else ElMessage.error(result?.message || '播放失败');
  } catch (e) {
    ElMessage.error('播放失败: ' + (e?.message || ''));
  } finally {
    resumeBackgroundLoading();
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
        favoriteFolderIdsByCode.value = {
          ...favoriteFolderIdsByCode.value,
          [movie.code]: res.data
        };
      }
    } catch (_) {}
  }
}

function goBack() {
  if (window.history.length > 1) {
    router.back();
  } else {
    if (listType.value === 'actor') router.push('/actors');
    else if (listType.value === 'genre') router.push('/genres');
    else if (listType.value === 'director') router.push('/directors');
    else if (listType.value === 'studio') router.push('/studios');
    else if (listType.value === 'favorite') router.push('/favorites');
    else if (listType.value === 'series' || listType.value === 'search') router.push('/');
    else router.push('/');
  }
}

watch(
  () => [route.path, route.params, route.query],
  () => {
    routeVersion.value += 1;
    avatarPickerVisible.value = false;
    actorProfileEditVisible.value = false;
    slotDialogVisible.value = false;
    favoriteDialogVisible.value = false;
    avatarPreviewVisible.value = false;
    syncCurrentPageFromState();
    loadData();
  },
  { deep: true }
);

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
  const doLoad = async () => {
    if (initialLoadDone.value || loadInProgress.value) return;
    loadInProgress.value = true;
    try {
      await loadData();
    } finally {
      loadInProgress.value = false;
    }
  };
  const tryLoad = async () => {
    try {
      const res = await window.electronAPI?.system?.isDatabaseReady?.();
      if (res?.ready) { await doLoad(); return; }
    } catch (e) {}
    const start = Date.now();
    const t = setInterval(async () => {
      if (initialLoadDone.value || Date.now() - start >= 15000) {
        clearInterval(t);
        if (!initialLoadDone.value) await doLoad();
        return;
      }
      try {
        const res = await window.electronAPI?.system?.isDatabaseReady?.();
        if (res?.ready) { clearInterval(t); await doLoad(); }
      } catch (e) {}
    }, 400);
  };
  if (window.electronAPI?.system?.onDatabaseReady) {
    window.electronAPI.system.onDatabaseReady(() => { if (!initialLoadDone.value && !loadInProgress.value) doLoad(); });
  }
  tryLoad();
  restoreScrollPosition(pageKey.value, 200);
  const onScroll = () => { lastScrollTop.value = window.scrollY ?? document.documentElement.scrollTop ?? 0; };
  lastScrollTop.value = window.scrollY ?? document.documentElement.scrollTop ?? 0;
  window.addEventListener('scroll', onScroll, { passive: true });
  scrollCleanupRef.value = () => window.removeEventListener('scroll', onScroll);

  if (window.electronAPI?.system?.onFileChange) {
    window.electronAPI.system.onFileChange(() => loadData());
  }
  if (window.electronAPI?.system?.onScanCompleted) {
    window.electronAPI.system.onScanCompleted(() => {
      scanStore.incrementDataVersion();
    });
  }
  window.addEventListener('filterPlayableChanged', () => loadData());
});

onActivated(() => {
  if (scrollCleanupRef.value) {
    scrollCleanupRef.value();
    scrollCleanupRef.value = null;
  }
  const onScroll = () => {
    lastScrollTop.value = window.scrollY ?? document.documentElement.scrollTop ?? 0;
  };
  lastScrollTop.value = window.scrollY ?? document.documentElement.scrollTop ?? 0;
  window.addEventListener('scroll', onScroll, { passive: true });
  scrollCleanupRef.value = () => window.removeEventListener('scroll', onScroll);

  if (scanStore.dataVersion > lastRefreshedDataVersion.value) {
    lastRefreshedDataVersion.value = scanStore.dataVersion;
    syncCurrentPageFromState();
    loadData();
  }
  restoreScrollPosition(pageKey.value, 200);
});

onDeactivated(() => {
  if (scrollCleanupRef.value) {
    scrollCleanupRef.value();
    scrollCleanupRef.value = null;
  }
  savePageState(pageKey.value, { currentPage: currentPage.value });
  saveScrollPosition(pageKey.value, lastScrollTop.value);
});

onBeforeUnmount(() => {
  savePageState(pageKey.value, { currentPage: currentPage.value });
  saveScrollPosition(pageKey.value);
});
</script>

<style scoped>
.movie-list-page { width: 100%; height: 100%; }
.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.header-left { display: flex; align-items: center; }
.header-title { margin: 0; margin-left: 16px; }
.header-left.no-back .header-title { margin-left: 0; }
.page-header {
  background-color: var(--header-bg);
  color: var(--title-color);
  display: flex;
  align-items: center;
  padding: 0 20px;
}

/* 演员列表页：标题与筛选器之间的头像+名称（仅当已配置演员数据路径且有头像时显示） */
.actor-header-block {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 16px 8px;
}
.actor-avatar-wrap {
  position: relative;
  flex-shrink: 0;
}
.actor-avatar-image {
  width: 150px;
  height: 150px;
  border-radius: 8px;
  display: block;
  background: var(--el-fill-color-light);
  cursor: pointer;
}
/* 悬浮遮罩：提示点击可放大查看，兼容日间/暗色主题 */
.actor-avatar-zoom-mask {
  position: absolute;
  inset: 0;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;
}
.actor-avatar-wrap:hover .actor-avatar-zoom-mask {
  opacity: 1;
}
.actor-avatar-zoom-icon {
  font-size: 36px;
  color: #fff;
}
.actor-avatar-slot {
  width: 100px;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  border-radius: 8px;
  background: var(--el-fill-color-light);
}
.actor-avatar-edit-icon {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 22px;
  height: 22px;
  padding: 2px;
  border-radius: 4px;
  background: var(--el-bg-color);
  color: var(--el-color-primary);
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
}
.actor-avatar-edit-icon:hover {
  background: var(--el-color-primary-light-9);
}
.actor-header-info {
  flex: 1;
  min-width: 0;
}
.actor-header-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.actor-header-name {
  font-size: 24px;
  font-weight: 700;
  color: var(--content-title-color, #303133);
}
.actor-name-edit-icon {
  font-size: 18px;
  color: var(--el-color-primary);
  cursor: pointer;
}
.actor-name-edit-icon:hover {
  color: var(--el-color-primary-light-3);
}
.actor-header-former-names {
  font-size: 13px;
  color: var(--content-subtitle-color, #909399);
  margin-top: 4px;
}
.actor-profile-edit-dialog .former-names-list {
  width: 100%;
}
.actor-profile-edit-dialog .former-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.actor-profile-edit-dialog .former-name-row .el-input {
  flex: 1;
}

.avatar-preview-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
}

.avatar-preview-img {
  max-width: 80vw;
  max-height: 80vh;
  object-fit: contain;
}

.avatar-preview-pagination {
  position: absolute;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  color: #fff;
  font-size: 14px;
}

.avatar-preview-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 36px;
  height: 48px;
  border: none;
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  cursor: pointer;
  font-size: 24px;
}

.avatar-preview-prev {
  left: 24px;
}

.avatar-preview-next {
  right: 24px;
}

.avatar-preview-close {
  position: absolute;
  top: 16px;
  right: 24px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  cursor: pointer;
  font-size: 20px;
}

.filter-bar {
  padding: 10px 16px 0;
}

.filter-group {
  margin-bottom: 6px;
}

.filter-group-row {
  display: flex;
  align-items: flex-start;
  flex-wrap: nowrap;
}

.filter-group-label {
  font-weight: bold;
  font-size: 13px;
  color: var(--content-title-color, #303133);
  padding-right: 8px;
  flex-shrink: 0;
  line-height: 28px;
}

.filter-group-tags-wrap {
  flex: 1;
  min-width: 0;
}

.filter-group-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: none;
  overflow: hidden;
  transition: max-height 0.2s ease;
}

.filter-group-tags.is-collapsed {
  max-height: 28px;
}

.filter-toggle {
  flex-shrink: 0;
  margin-left: 8px;
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-small);
}

.filter-tag {
  font-size: 12px;
}

.filter-toggle-icon {
  margin-left: 4px;
}

.filter-collapse-toggle {
  display: flex;
  justify-content: center;
  margin: 4px 0 6px;
}

.filter-collapse-button {
  font-size: 12px;
  padding: 4px 12px;
}

/* 抽奖入口：上下结构，小窗时不被压缩 */
.lottery-entry {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-right: 12px;
  flex-shrink: 0;
}
.lottery-hint-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.lottery-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}
.lottery-hint-icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  cursor: help;
}
.lottery-hint-icon-wrap .el-icon {
  font-size: 12px;
}
.lottery-btn {
  width: 60%;
}
</style>
