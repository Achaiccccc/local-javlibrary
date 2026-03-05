<template>
  <el-card>
    <template #header>
      <div class="toolbar">
        <div class="toolbar-left">
          <span>每页显示：</span>
          <el-select
            :model-value="pageSize"
            style="width: 100px;"
            @change="$emit('update:pageSize', $event)"
          >
            <el-option label="10" :value="10" />
            <el-option label="20" :value="20" />
            <el-option label="30" :value="30" />
            <el-option label="50" :value="50" />
            <el-option label="100" :value="100" />
            <el-option label="500" :value="500" />
            <el-option label="1000" :value="1000" />
          </el-select>
          <span style="margin-left: 16px;">排序：</span>
          <el-select
            :model-value="sortBy"
            style="width: 180px;"
            @change="$emit('update:sortBy', $event)"
          >
            <el-option label="按发行时间排序-正序" value="premiered-asc" />
            <el-option label="按发行时间排序-倒序" value="premiered-desc" />
            <el-option label="按更新时间排序-正序" value="folder_updated_at-asc" />
            <el-option label="按更新时间排序-倒序" value="folder_updated_at-desc" />
            <el-option label="按标题排序-正序" value="title-asc" />
            <el-option label="按标题排序-倒序" value="title-desc" />
          </el-select>
          <!-- 预留左侧插槽（例如搜索结果统计文案等） -->
          <slot name="left-extra" />
        </div>
        <div class="toolbar-right">
          <!-- 抽奖入口：在视图模式左侧 -->
          <slot name="before-view-mode" />
          <el-radio-group
            v-if="enableViewModeToggle"
            class="view-mode-toggle"
            :model-value="viewMode"
            @change="$emit('update:viewMode', $event)"
          >
            <el-radio-button label="thumbnail">缩图模式</el-radio-button>
            <el-radio-button label="text">文字模式</el-radio-button>
            <el-radio-button label="card">图文模式</el-radio-button>
          </el-radio-group>
          <!-- 预留右侧插槽 -->
          <slot name="right-extra" />
        </div>
      </div>
    </template>

    <div v-if="loading">加载中...</div>
    <div v-else-if="movies.length === 0" class="empty-state">
      <el-empty :description="emptyText" />
    </div>
    <div v-else>
      <!-- 缩图模式：动态宽度多列，两边边距一致；悬浮时固定层放大+动画 -->
      <div
        v-if="viewMode === 'thumbnail'"
        ref="posterWaterfallRef"
        class="poster-waterfall"
        :style="posterWaterfallStyle"
      >
        <div
          v-for="movie in movies"
          :key="movie.id"
          class="poster-waterfall-item"
          :style="posterItemStyle"
          @click="onPosterClick(movie)"
          @mouseenter="e => onPosterHover(e, movie)"
          @mouseleave="onPosterLeave"
        >
          <div class="poster-waterfall-img-wrap" :style="posterWrapStyle">
            <el-image
              :src="imageCache?.[getImageCacheKey(movie?.poster_path, movie?.data_path_index)] || ''"
              fit="cover"
              class="poster-waterfall-img"
              :lazy="true"
              @load="onImageLoad(movie)"
            >
              <template #error>
                <div class="poster-waterfall-slot" :style="posterWrapStyle">暂无封面</div>
              </template>
            </el-image>
          </div>
        </div>
      </div>

      <!-- 文字模式 -->
      <el-table
        v-else-if="viewMode === 'text'"
        :data="movies"
        style="width: 100%"
        @row-click="row => $emit('rowClick', row)"
      >
        <el-table-column prop="title" label="标题" />
        <el-table-column prop="code" label="识别码" width="150" />
        <el-table-column prop="premiered" label="发行日期" width="120" />
      </el-table>

      <!-- 图文模式：卡片网格 -->
      <div v-else class="movies-grid">
        <el-card
          v-for="movie in movies"
          :key="movie.id"
          class="movie-card"
          shadow="hover"
          @click="$emit('rowClick', movie)"
        >
          <div class="movie-poster">
            <el-image
              :src="imageCache?.[getImageCacheKey(movie?.poster_path, movie?.data_path_index)] || ''"
              fit="contain"
              style="width: 100%; height: 100%;"
              :lazy="true"
              @load="onImageLoad(movie)"
            >
              <template #error>
                <div class="image-slot">暂无封面</div>
              </template>
            </el-image>
            <div v-if="movie.playable" class="play-icon" @click.stop="$emit('playVideo', movie)">
              <el-icon :size="24" color="#67c23a">
                <VideoPlay />
              </el-icon>
            </div>
            <div
              v-if="showFavoriteHeart"
              class="favorite-icon"
              :class="{ 'is-favorited': isFavorited(movie) }"
              @click.stop="$emit('toggleFavorite', movie)"
            >
              <el-icon :size="20">
                <StarFilled v-if="isFavorited(movie)" />
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

      <!-- 分页 -->
      <div class="pagination" v-if="showPagination">
        <el-pagination
          v-model:current-page="internalCurrentPage"
          v-model:page-size="internalPageSize"
          :total="total"
          :page-sizes="[10, 20, 30, 50, 100, 500, 1000]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="val => $emit('update:pageSize', val)"
          @current-change="val => $emit('update:currentPage', val)"
        />
      </div>
      <!-- 缩图模式悬浮放大层：挂到 body + 进入/离开动画 -->
      <Teleport to="body">
        <Transition name="poster-overlay">
          <div
            v-if="hoveredPoster"
            class="poster-waterfall-overlay"
            :style="hoveredPoster.style"
          >
            <img
              :src="hoveredPoster.src"
              alt=""
              class="poster-waterfall-overlay-img"
            />
          </div>
        </Transition>
      </Teleport>
    </div>
  </el-card>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useElementSize } from '@vueuse/core';
import { VideoPlay, Star, StarFilled } from '@element-plus/icons-vue';
import { getImageCacheKey } from '../utils/imageLoader';

const BASE_COL_WIDTH = 150;
const ASPECT_RATIO = 0.7;
const HOVER_SCALE = 1.5;
const hoveredPoster = ref(null);
const posterWaterfallRef = ref(null);
const { width: waterfallWidth } = useElementSize(posterWaterfallRef);

const posterLayout = computed(() => {
  const w = waterfallWidth.value || BASE_COL_WIDTH * 4;
  const cols = Math.max(1, Math.round(w / BASE_COL_WIDTH));
  const itemWidth = w / cols;
  const itemHeight = itemWidth / ASPECT_RATIO;
  return { cols, itemWidth, itemHeight };
});

const posterWaterfallStyle = computed(() => ({
  gridTemplateColumns: `repeat(${posterLayout.value.cols}, ${posterLayout.value.itemWidth}px)`
}));

const posterItemStyle = computed(() => ({
  width: `${posterLayout.value.itemWidth}px`
}));

const posterWrapStyle = computed(() => ({
  width: `${posterLayout.value.itemWidth}px`,
  height: `${posterLayout.value.itemHeight}px`
}));

function onPosterHover(e, movie) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const { itemWidth, itemHeight } = posterLayout.value;
  const w = itemWidth * HOVER_SCALE;
  const h = itemHeight * HOVER_SCALE;
  hoveredPoster.value = {
    style: {
      left: `${rect.left + rect.width / 2 - w / 2}px`,
      top: `${rect.top + rect.height / 2 - h / 2}px`,
      width: `${w}px`,
      height: `${h}px`
    },
    src: props.imageCache?.[getImageCacheKey(movie?.poster_path, movie?.data_path_index)] || ''
  };
}

function onPosterLeave() {
  hoveredPoster.value = null;
}

const emit = defineEmits(['rowClick', 'update:pageSize', 'update:currentPage', 'update:sortBy', 'update:viewMode', 'playVideo', 'toggleFavorite']);

function onPosterClick(movie) {
  hoveredPoster.value = null;
  emit('rowClick', movie);
}

const props = defineProps({
  loading: { type: Boolean, default: false },
  movies: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  currentPage: { type: Number, default: 1 },
  pageSize: { type: Number, default: 20 },
  sortBy: { type: String, default: 'premiered-desc' },
  viewMode: { type: String, default: 'card' }, // 'thumbnail' | 'text' | 'card'
  imageCache: { type: Object, default: () => ({}) },
  emptyText: { type: String, default: '暂无影片数据' },
  enableViewModeToggle: { type: Boolean, default: true },
  showPagination: { type: Boolean, default: true },
  loadMovieImage: { type: Function, default: null },
  /** 是否显示收藏爱心图标（图文模式） */
  showFavoriteHeart: { type: Boolean, default: false },
  /** 按影片 code 的收藏夹 id 列表，用于判断是否已收藏：{ [code]: string[] } */
  favoriteFolderIdsByCode: { type: Object, default: () => ({}) }
});

function isFavorited(movie) {
  if (!movie?.code) return false;
  const ids = props.favoriteFolderIdsByCode[movie.code];
  return Array.isArray(ids) && ids.length > 0;
}

const internalCurrentPage = computed({
  get: () => props.currentPage,
  set: (val) => {
    // 仅用于 v-model 绑定，真实更新通过 @update:currentPage 通知外层
  }
});

const internalPageSize = computed({
  get: () => props.pageSize,
  set: (val) => {
    // 同上
  }
});

const onImageLoad = (movie) => {
  if (typeof props.loadMovieImage === 'function') {
    props.loadMovieImage(movie);
  }
};
</script>

<style scoped>
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

/* 缩图模式：动态列宽由 style 注入，无边框无间距 */
.poster-waterfall {
  display: grid;
  gap: 0;
  justify-content: start;
  width: 100%;
  padding: 0;
}

.poster-waterfall-item {
  margin: 0;
  padding: 0;
  cursor: pointer;
}

.poster-waterfall-img-wrap {
  overflow: hidden;
  position: relative;
}

.poster-waterfall-img {
  width: 100%;
  height: 100%;
  display: block;
}

.poster-waterfall-img-wrap :deep(.el-image) {
  width: 100%;
  height: 100%;
}

.poster-waterfall-img-wrap :deep(.el-image__inner) {
  object-fit: cover;
}

/* 悬浮放大层：position:fixed + 进入/离开动画（缩放以中心为原点） */
.poster-waterfall-overlay {
  position: fixed;
  z-index: 10000;
  pointer-events: none;
  overflow: hidden;
  border-radius: 2px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
  transform-origin: center;
}

.poster-waterfall-overlay-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* 悬浮层过渡：缩放 + 透明度 */
.poster-overlay-enter-active,
.poster-overlay-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.poster-overlay-enter-from,
.poster-overlay-leave-to {
  opacity: 0;
  transform: scale(0.92);
}

.poster-overlay-enter-to,
.poster-overlay-leave-from {
  opacity: 1;
  transform: scale(1);
}

.poster-waterfall-slot {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--image-slot-bg);
  color: var(--image-slot-color);
  font-size: 12px;
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
  cursor: pointer;
}
.favorite-icon {
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
.favorite-icon.is-favorited {
  color: #f56c6c;
}
.favorite-icon .el-icon {
  display: flex;
  align-items: center;
  justify-content: center;
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
  color: var(--movie-title-color);
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

