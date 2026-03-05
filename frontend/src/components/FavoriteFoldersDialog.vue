<template>
  <el-dialog
    v-model="dialogVisible"
    title="选择收藏夹"
    width="420px"
    destroy-on-close
    @closed="onClosed"
  >
    <p class="dialog-hint">勾选要加入的收藏夹，可多选。</p>
    <el-checkbox-group v-model="selectedIds" class="folder-list">
      <div v-for="folder in folders" :key="folder.id" class="folder-item">
        <el-checkbox :label="folder.id">{{ folder.name }}</el-checkbox>
      </div>
    </el-checkbox-group>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" @click="submit">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
defineOptions({ name: 'FavoriteFoldersDialog' });
import { ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 当前影片，需含 code */
  movie: { type: Object, default: null }
});
const emit = defineEmits(['update:modelValue', 'done']);

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
});

const folders = ref([]);
const selectedIds = ref([]);

async function loadFolders() {
  try {
    const res = await window.electronAPI.favorites.getFolders();
    if (res?.success && Array.isArray(res.data)) {
      folders.value = res.data;
    }
  } catch (e) {
    console.error(e);
  }
}

async function loadSelected() {
  if (!props.movie?.code) {
    selectedIds.value = [];
    return;
  }
  try {
    const res = await window.electronAPI.favorites.getFoldersContainingMovie(props.movie.code);
    if (res?.success && Array.isArray(res.data)) {
      selectedIds.value = [...res.data];
    } else {
      selectedIds.value = [];
    }
  } catch (e) {
    selectedIds.value = [];
  }
}

async function submit() {
  const code = props.movie?.code;
  if (!code) {
    dialogVisible.value = false;
    return;
  }
  const ids = Array.isArray(selectedIds.value) ? selectedIds.value.slice().map(String) : [];
  try {
    const result = await window.electronAPI.favorites.setMovieFolders(code, ids);
    if (result && result.success) {
      ElMessage.success('已更新收藏');
      dialogVisible.value = false;
      emit('done');
    } else {
      ElMessage.error(result?.message || '更新失败');
    }
  } catch (e) {
    console.error('收藏更新异常:', e);
    ElMessage.error(e?.message || '更新失败');
  }
}

function onClosed() {
  folders.value = [];
  selectedIds.value = [];
}

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      await loadFolders();
      await loadSelected();
    }
  }
);
</script>

<style scoped>
.dialog-hint {
  margin: 0 0 12px 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.folder-list {
  max-height: 320px;
  overflow-y: auto;
}
.folder-item {
  padding: 6px 0;
}
.folder-item :deep(.el-checkbox) {
  width: 100%;
}
</style>
