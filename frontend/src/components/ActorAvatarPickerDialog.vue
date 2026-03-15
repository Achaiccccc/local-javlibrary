<template>
  <el-dialog
    v-model="dialogVisible"
    :title="'选择头像：' + (actorName || '')"
    width="520px"
    destroy-on-close
    class="actor-avatar-picker-dialog"
    @closed="onClosed"
  >
    <div v-if="loading" class="picker-loading">加载中...</div>
    <div v-else-if="!candidates.length" class="picker-empty">暂无可选头像</div>
    <el-radio-group v-else v-model="selectedId" class="candidate-list">
      <div v-for="c in candidates" :key="c.id" class="candidate-item">
        <el-radio :label="c.id">
          <div class="candidate-preview">
            <el-image :src="c.url" fit="cover" class="candidate-img">
              <template #error>
                <div class="candidate-img-slot">加载失败</div>
              </template>
            </el-image>
            <span class="candidate-label">{{ c.targetFile || c.id }}</span>
          </div>
        </el-radio>
      </div>
    </el-radio-group>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" @click="submit" :disabled="!selectedId">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
defineOptions({ name: 'ActorAvatarPickerDialog' });
import { ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  actorName: { type: String, default: '' }
});
const emit = defineEmits(['update:modelValue', 'done']);

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
});

const loading = ref(false);
const candidates = ref([]);
const selectedId = ref('');

async function loadCandidates() {
  if (!props.actorName?.trim()) {
    candidates.value = [];
    selectedId.value = '';
    return;
  }
  loading.value = true;
  try {
    const res = await window.electronAPI?.actorAvatars?.getCandidatesByName?.(props.actorName.trim());
    if (res?.success && Array.isArray(res.data?.candidates)) {
      candidates.value = res.data.candidates;
      selectedId.value = res.data.selectedId || (candidates.value[0]?.id ?? '');
    } else {
      candidates.value = [];
      selectedId.value = '';
    }
  } catch (e) {
    console.error(e);
    candidates.value = [];
    selectedId.value = '';
  } finally {
    loading.value = false;
  }
}

async function submit() {
  if (!props.actorName?.trim() || !selectedId.value) {
    dialogVisible.value = false;
    return;
  }
  try {
    const result = await window.electronAPI?.actorAvatars?.setSelectionByName?.(props.actorName.trim(), selectedId.value);
    if (result?.success) {
      ElMessage.success('已更换头像');
      emit('done', { selectedId: selectedId.value });
      dialogVisible.value = false;
    } else {
      ElMessage.error(result?.message || '保存失败');
    }
  } catch (e) {
    ElMessage.error('保存失败: ' + (e?.message || e));
  }
}

function onClosed() {
  candidates.value = [];
  selectedId.value = '';
}

watch(
  () => [props.modelValue, props.actorName],
  ([visible, name]) => {
    if (visible && name) loadCandidates();
  },
  { immediate: true }
);
</script>

<style scoped>
.picker-loading,
.picker-empty {
  padding: 24px;
  text-align: center;
  color: var(--el-text-color-secondary);
}
.candidate-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  max-height: 60vh;
  overflow-y: auto;
}
.candidate-item {
  width: 120px;
}
.candidate-item :deep(.el-radio) {
  display: block;
  height: auto;
  margin-right: 0;
}
.candidate-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.candidate-img {
  width: 80px;
  height: 80px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
}
.candidate-img-slot {
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}
.candidate-label {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
