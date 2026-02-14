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
          <el-radio-group
            v-if="enableViewModeToggle"
            :model-value="viewMode"
            @change="$emit('update:viewMode', $event)"
          >
            <el-radio-button label="text">文字模式</el-radio-button>
            <el-radio-button label="thumbnail">缩图模式</el-radio-button>
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
      <!-- 文字模式 -->
      <el-table
        v-if="viewMode === 'text'"
        :data="movies"
        style="width: 100%"
        @row-click="row => $emit('rowClick', row)"
      >
        <el-table-column prop="title" label="标题" />
        <el-table-column prop="code" label="识别码" width="150" />
        <el-table-column prop="premiered" label="发行日期" width="120" />
      </el-table>

      <!-- 缩图模式 -->
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
            <div v-if="movie.playable" class="play-icon">
              <el-icon :size="24" color="#67c23a">
                <VideoPlay />
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
          :page-sizes="[10, 20, 30, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="val => $emit('update:pageSize', val)"
          @current-change="val => $emit('update:currentPage', val)"
        />
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { computed } from 'vue';
import { VideoPlay } from '@element-plus/icons-vue';
import { getImageCacheKey } from '../utils/imageLoader';

const props = defineProps({
  loading: { type: Boolean, default: false },
  movies: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  currentPage: { type: Number, default: 1 },
  pageSize: { type: Number, default: 20 },
  sortBy: { type: String, default: 'premiered-desc' },
  viewMode: { type: String, default: 'thumbnail' }, // 'text' | 'thumbnail'
  imageCache: { type: Object, default: () => ({}) },
  emptyText: { type: String, default: '暂无影片数据' },
  enableViewModeToggle: { type: Boolean, default: true },
  showPagination: { type: Boolean, default: true },
  /**
   * 图片加载函数：(movie) => void
   * 默认什么都不做，由上层决定如何加载图片和写入缓存
   */
  loadMovieImage: { type: Function, default: null }
});

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

