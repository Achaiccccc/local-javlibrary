<template>
  <div class="favorites-page">
    <el-container>
      <el-header class="page-header">
        <div class="header-content">
          <h1 class="header-title">收藏夹</h1>
          <div class="header-actions">
            <ThemeSwitch />
          </div>
        </div>
      </el-header>
      <el-main class="page-theme-bg">
        <el-card>
          <div class="folder-list">
            <div v-for="folder in folders" :key="folder.id" class="folder-block">
              <div class="folder-row">
                <div class="folder-name-wrap">
                  <el-link type="primary" @click="goToFolder(folder.id)" class="folder-name">{{ folder.name }}</el-link>
                  <div class="folder-preview-row">
                    <div
                      v-for="movie in (folderPreviews[folder.id]?.data || [])"
                      :key="movie.id"
                      class="preview-poster-wrap"
                      @click="goToMovie(movie.id)"
                    >
                      <el-image
                        class="preview-poster"
                        :src="previewImageCache[getImageCacheKey(movie.poster_path, movie.data_path_index ?? 0)] || ''"
                        fit="cover"
                      >
                        <template #error>
                          <div class="preview-poster-placeholder">暂无封面</div>
                        </template>
                      </el-image>
                    </div>
                  </div>
                </div>
                <div class="folder-actions">
                  <el-button
                    v-if="!folder.isDefault"
                    link
                    type="primary"
                    size="small"
                    @click="openEditDialog(folder)"
                  >
                    编辑
                  </el-button>
                  <el-button
                    v-if="!folder.isDefault"
                    link
                    type="danger"
                    size="small"
                    @click="confirmDelete(folder)"
                  >
                    删除
                  </el-button>
                </div>
              </div>
            </div>
          </div>
          <div class="favorites-create-row">
            <el-button link type="primary" @click="openCreateDialog">
              <el-icon class="create-icon"><Plus /></el-icon>
              新建收藏夹
            </el-button>
          </div>
        </el-card>
        <el-dialog v-model="createVisible" title="新建收藏夹" width="400px" @closed="createName = ''">
          <el-input v-model="createName" placeholder="请输入收藏夹名称" maxlength="50" show-word-limit />
          <template #footer>
            <el-button @click="createVisible = false">取消</el-button>
            <el-button type="primary" @click="submitCreate">确定</el-button>
          </template>
        </el-dialog>
        <el-dialog v-model="editVisible" title="编辑收藏夹" width="400px" @closed="editName = ''">
          <el-input v-model="editName" placeholder="请输入收藏夹名称" maxlength="50" show-word-limit />
          <template #footer>
            <el-button @click="editVisible = false">取消</el-button>
            <el-button type="primary" @click="submitEdit">确定</el-button>
          </template>
        </el-dialog>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
defineOptions({ name: 'FavoritesPage' });
import { ref, onMounted, onActivated } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import ThemeSwitch from '../components/ThemeSwitch.vue';
import { getImageCacheKey } from '../utils/imageLoader';

const PREVIEW_PAGE_SIZE = 8;

const router = useRouter();
const folders = ref([]);
const folderPreviews = ref({});
const previewImageCache = ref({});
const createVisible = ref(false);
const createName = ref('');
const editVisible = ref(false);
const editName = ref('');
const editingId = ref('');

async function loadFolderPreview(folderId) {
  try {
    const res = await window.electronAPI.favorites.getMoviesByFolder(folderId, {
      page: 1,
      pageSize: PREVIEW_PAGE_SIZE,
      sortBy: 'addedAt-desc'
    });
    if (res?.success && res.data) {
      folderPreviews.value = { ...folderPreviews.value, [folderId]: { data: res.data, total: res.total || 0 } };
      res.data.forEach(m => loadPreviewImage(m));
    }
  } catch (e) {
    console.error('loadFolderPreview', e);
  }
}

function loadPreviewImage(movie) {
  if (!movie?.poster_path) return;
  const key = getImageCacheKey(movie.poster_path, movie.data_path_index ?? 0);
  if (previewImageCache.value[key]) return;
  window.electronAPI.movies.getImage(movie.poster_path, movie.data_path_index ?? 0).then(url => {
    if (url) {
      previewImageCache.value = { ...previewImageCache.value, [key]: url };
    }
  });
}

function goToMovie(id) {
  router.push(`/movie/${id}`);
}

async function loadFolders() {
  try {
    const res = await window.electronAPI.favorites.getFolders();
    if (res?.success && Array.isArray(res.data)) {
      folders.value = res.data;
      folderPreviews.value = {};
      res.data.forEach(f => loadFolderPreview(f.id));
    }
  } catch (e) {
    console.error(e);
    ElMessage.error('加载收藏夹失败');
  }
}

function goToFolder(id) {
  router.push(`/favorite/${encodeURIComponent(id)}`);
}

function openCreateDialog() {
  createVisible.value = true;
}

async function submitCreate() {
  const name = (createName.value || '').trim();
  if (!name) {
    ElMessage.warning('请输入收藏夹名称');
    return;
  }
  try {
    const res = await window.electronAPI.favorites.createFolder(name);
    if (res?.success) {
      ElMessage.success('已创建');
      createVisible.value = false;
      createName.value = '';
      await loadFolders();
    }
  } catch (e) {
    ElMessage.error('创建失败');
  }
}

function openEditDialog(row) {
  editingId.value = row.id;
  editName.value = row.name;
  editVisible.value = true;
}

async function submitEdit() {
  const name = (editName.value || '').trim();
  if (!name) {
    ElMessage.warning('请输入收藏夹名称');
    return;
  }
  try {
    const res = await window.electronAPI.favorites.updateFolder(editingId.value, name);
    if (res?.success) {
      ElMessage.success('已修改');
      editVisible.value = false;
      editName.value = '';
      await loadFolders();
    }
  } catch (e) {
    ElMessage.error('修改失败');
  }
}

function confirmDelete(row) {
  ElMessageBox.confirm(`确定删除收藏夹「${row.name}」吗？仅删除收藏夹，不会删除影片数据。`, '删除收藏夹', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      const res = await window.electronAPI.favorites.deleteFolder(row.id);
      if (res?.success) {
        ElMessage.success('已删除');
        await loadFolders();
      }
    } catch (e) {
      ElMessage.error('删除失败');
    }
  }).catch(() => {});
}

onMounted(() => {
  loadFolders();
});

// 从详情/列表页修改收藏后返回时，刷新收藏夹列表与预览（页面被 keep-alive 缓存，onMounted 不会再次执行）
onActivated(() => {
  loadFolders();
});
</script>

<style scoped>
.favorites-page {
  height: 100%;
}
.page-header {
  display: flex;
  align-items: center;
  background: var(--nav-bg);
  border-bottom: 1px solid var(--header-border);
}
.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.header-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}
.header-actions {
  display: flex;
  align-items: center;
}
.folder-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.folder-block {
  border-bottom: 1px solid var(--el-border-color-lighter);
  padding-bottom: 16px;
}
.folder-block:last-of-type {
  border-bottom: none;
}
.folder-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.folder-name-wrap {
  flex: 1;
  min-width: 0;
}
.folder-name {
  font-size: 16px;
  font-weight: 500;
}
.folder-preview-row {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  margin-top: 10px;
  overflow: hidden;
}
.preview-poster-wrap {
  flex: 0 0 120px;
  width: 120px;
  height: 180px;
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  background: var(--el-fill-color-light);
}
.preview-poster {
  width: 100%;
  height: 100%;
}
.preview-poster-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.folder-actions {
  flex-shrink: 0;
}
.favorites-create-row {
  display: flex;
  justify-content: flex-start;
  padding: 20px 0 8px;
}
.favorites-create-row .create-icon {
  margin-right: 4px;
  vertical-align: middle;
}
</style>
