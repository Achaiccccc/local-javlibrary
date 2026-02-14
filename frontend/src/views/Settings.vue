<template>
  <div class="settings">
    <el-container>
      <el-header>
        <h1 style="margin: 0;">设置</h1>
      </el-header>
      <el-main>
        <el-card>
          <template #header>
            <span>数据路径设置</span>
          </template>
          <el-form :model="form" label-width="120px">
            <el-form-item label="数据路径">
              <div style="width: 100%;">
                <div
                  v-for="(path, index) in dataPaths"
                  :key="index"
                  style="margin-bottom: 8px; display: flex; align-items: center; gap: 8px;"
                >
                  <el-input v-model="dataPaths[index]" readonly style="flex: 1;">
                    <template #append>
                      <el-button
                        type="danger"
                        :icon="Delete"
                        @click="removePath(index)"
                        :disabled="dataPaths.length <= 1"
                      >
                        删除
                      </el-button>
                    </template>
                  </el-input>
                </div>
                <el-button
                  type="primary"
                  :icon="Plus"
                  @click="addPath"
                  style="width: 100%; margin-top: 8px;"
                >
                  添加路径
                </el-button>
              </div>
            </el-form-item>
            <el-form-item>
              <el-button @click="goBack">返回</el-button>
            </el-form-item>
          </el-form>
        </el-card>
        
        <el-card style="margin-top: 20px;">
          <template #header>
            <span>数据扫描</span>
          </template>
          <el-form label-width="120px">
            <el-form-item label="扫描操作">
              <el-button type="default" @click="scanData" :loading="scanning" :disabled="scanning || syncDiffLoading">
                完整扫描
              </el-button>
              <el-button type="primary" @click="runSyncDiff" :loading="syncDiffLoading" :disabled="scanning || syncDiffLoading" style="margin-left: 8px;">
                仅扫描新增或修改
              </el-button>
            </el-form-item>
            <el-form-item v-if="scanning || scanProgress.total > 0" label="完整扫描进度">
              <div style="width: 100%;">
                <el-progress
                  :percentage="scanProgress.percentage"
                  :status="scanProgress.status"
                  :stroke-width="8"
                  :format="() => formatProgressText.value"
                  style="font-size: 12px;"
                />
                <div style="margin-top: 4px; font-size: 11px; color: #909399;">
                  成功: {{ scanProgress.success }} | 失败: {{ scanProgress.failed }}
                </div>
              </div>
            </el-form-item>
            <el-form-item v-if="syncDiffLoading || syncDiffProgress.total > 0" label="增量扫描进度">
              <div style="width: 100%;">
                <el-progress
                  :percentage="syncDiffProgress.percentage"
                  :stroke-width="8"
                  :format="() => syncDiffProgress.total > 0 ? `${syncDiffProgress.current}/${syncDiffProgress.total} (${syncDiffProgress.percentage}%)` : (syncDiffProgress.message || '处理中…')"
                  style="font-size: 12px;"
                />
                <div v-if="syncDiffProgress.message" style="margin-top: 4px; font-size: 11px; color: #909399;">
                  {{ syncDiffProgress.message }}
                </div>
              </div>
            </el-form-item>
            <el-form-item v-if="syncDiffResult" label="增量扫描结果">
              <div class="sync-diff-result">
                <div v-if="syncDiffResult.removed > 0" style="margin-bottom: 8px;">
                  <el-text type="info">已删除 {{ syncDiffResult.removed }} 条（磁盘已不存在的记录）</el-text>
                </div>
                <div v-if="syncDiffResult.addedList && syncDiffResult.addedList.length > 0" style="margin-bottom: 8px;">
                  <el-text type="success">成功新增 {{ syncDiffResult.addedList.length }} 条</el-text>
                  <el-collapse>
                    <el-collapse-item title="查看列表" name="added">
                      <ul class="sync-diff-list">
                        <li v-for="(item, idx) in syncDiffResult.addedList" :key="idx">{{ item.path }}</li>
                      </ul>
                    </el-collapse-item>
                  </el-collapse>
                </div>
                <div v-if="syncDiffResult.duplicateList && syncDiffResult.duplicateList.length > 0" style="margin-bottom: 8px;">
                  <el-text type="warning">重复数据 {{ syncDiffResult.duplicateList.length }} 条（库中已存在同番号，仅更新路径等信息）</el-text>
                  <el-collapse>
                    <el-collapse-item title="查看列表" name="duplicate">
                      <ul class="sync-diff-list">
                        <li v-for="(item, idx) in syncDiffResult.duplicateList" :key="idx">{{ item.path }}</li>
                      </ul>
                    </el-collapse-item>
                  </el-collapse>
                </div>
                <div v-if="syncDiffResult.failedList && syncDiffResult.failedList.length > 0">
                  <el-text type="danger">失败 {{ syncDiffResult.failedList.length }} 条</el-text>
                  <el-collapse>
                    <el-collapse-item title="查看列表及原因" name="failed">
                      <ul class="sync-diff-list sync-diff-failed">
                        <li v-for="(item, idx) in syncDiffResult.failedList" :key="idx">
                          <span class="path">{{ item.path }}</span>
                          <span class="reason">{{ item.reason }}</span>
                        </li>
                      </ul>
                    </el-collapse-item>
                  </el-collapse>
                </div>
                <div v-if="syncDiffResult.added === 0 && syncDiffResult.removed === 0 && (!syncDiffResult.failedList || syncDiffResult.failedList.length === 0) && (!syncDiffResult.duplicateList || syncDiffResult.duplicateList.length === 0)" style="margin-top: 4px;">
                  <el-text type="info">数据已与磁盘一致，无需更新</el-text>
                </div>
              </div>
            </el-form-item>
            <el-form-item label="扫描说明">
              <el-text type="info" size="small" style="display: block;">
                完整扫描：读取所有 NFO 并全量更新数据库（首次或需要重建时使用）。
              </el-text>
              <el-text type="info" size="small" style="display: block; margin-top: 4px;">
                仅扫描新增或修改：与启动时一致，对比磁盘与库，只新增缺失作品、删除数据库中实际已不存在的记录，数据量大时更快。同一番号对应多目录时，库中仅保留一条记录。
              </el-text>
            </el-form-item>
          </el-form>
        </el-card>
        
        <el-card style="margin-top: 20px;">
          <template #header>
            <span>显示设置</span>
          </template>
          <el-form label-width="120px">
            <el-form-item label="仅显示可播放">
              <el-switch
                v-model="filterPlayable"
                @change="handleFilterPlayableChange"
                active-text="是"
                inactive-text="否"
              />
            </el-form-item>
            <el-form-item label="说明">
              <el-text type="info" size="small">
                勾选后，所有页面仅显示包含视频文件的作品。
              </el-text>
            </el-form-item>
          </el-form>
        </el-card>
        
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Delete } from '@element-plus/icons-vue';

const router = useRouter();
const dataPaths = ref([]);
const scanning = ref(false);
const syncDiffLoading = ref(false);
const syncDiffProgress = ref({
  phase: '',
  current: 0,
  total: 0,
  message: '',
  percentage: 0
});
const syncDiffResult = ref(null); // { added, removed, addedList, failedList }
const filterPlayable = ref(false);
const scanProgress = ref({
  current: 0,
  total: 0,
  success: 0,
  failed: 0,
  percentage: 0,
  status: null // null, 'success', 'exception'
});

const formatProgressText = computed(() => {
  if (scanProgress.value.total === 0) {
    return '统计中...';
  }
  return `${scanProgress.value.current}/${scanProgress.value.total} (${scanProgress.value.percentage}%)`;
});

const loadDataPaths = async () => {
  try {
    const paths = await window.electronAPI.config.getDataPaths();
    dataPaths.value = paths && paths.length > 0 ? paths : [];
  } catch (error) {
    console.error('加载数据路径失败:', error);
    // 兼容旧版本：尝试获取单个路径
    try {
      const path = await window.electronAPI.config.getDataPath();
      dataPaths.value = path ? [path] : [];
    } catch (e) {
      dataPaths.value = [];
    }
  }
};

const loadFilterPlayable = async () => {
  try {
    filterPlayable.value = await window.electronAPI.settings.getFilterPlayable();
  } catch (error) {
    console.error('加载过滤设置失败:', error);
  }
};

const handleFilterPlayableChange = async (value) => {
  try {
    await window.electronAPI.settings.setFilterPlayable(value);
    ElMessage.success(value ? '已启用仅显示可播放作品' : '已关闭仅显示可播放作品');
    // 通知其他页面刷新数据
    window.dispatchEvent(new CustomEvent('filterPlayableChanged', { detail: value }));
  } catch (error) {
    console.error('保存过滤设置失败:', error);
    ElMessage.error('保存设置失败: ' + error.message);
    // 恢复原值
    filterPlayable.value = !value;
  }
};

const handleUseNfoActorsChange = async (value) => {
  try {
    await window.electronAPI.settings.setUseNfoActors(value);
    ElMessage.success(value ? '已切换到NFO演员数据' : '已切换到文件夹演员数据');
    // 通知其他页面刷新数据
    window.dispatchEvent(new CustomEvent('useNfoActorsChanged', { detail: value }));
  } catch (error) {
    console.error('保存NFO演员设置失败:', error);
    ElMessage.error('保存设置失败: ' + error.message);
    // 恢复原值
    useNfoActors.value = !value;
  }
};

const addPath = async () => {
  try {
    const result = await window.electronAPI.config.addDataPath();
    if (result.success) {
      dataPaths.value = result.paths || [];
      ElMessage.success('路径已添加');
    } else {
      ElMessage.warning(result.message || '操作已取消');
    }
  } catch (error) {
    ElMessage.error('添加路径失败: ' + error.message);
  }
};

const removePath = async (index) => {
  try {
    if (dataPaths.value.length <= 1) {
      ElMessage.warning('至少需要保留一个数据路径');
      return;
    }
    
    await ElMessageBox.confirm(
      `确定要删除路径 "${dataPaths.value[index]}" 吗？删除后需要重新扫描数据。`,
      '确认删除',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    );
    
    const pathToRemove = dataPaths.value[index];
    const result = await window.electronAPI.config.removeDataPath(pathToRemove);
    if (result.success) {
      dataPaths.value = result.paths || [];
      ElMessage.success('路径已删除');
      // 可选：自动触发扫描
      ElMessage.info('建议重新扫描数据以更新数据库');
    } else {
      ElMessage.error(result.message || '删除失败');
    }
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('删除路径失败: ' + error.message);
    }
  }
};

const runSyncDiff = async () => {
  if (dataPaths.value.length === 0) {
    ElMessage.warning('请先添加数据路径');
    return;
  }
  syncDiffLoading.value = true;
  syncDiffResult.value = null;
  syncDiffProgress.value = { phase: '', current: 0, total: 0, message: '准备中…', percentage: 0 };
  try {
    const result = await window.electronAPI.system.runStartupSync();
    if (result.success === false) {
      ElMessage.error(result.message || '执行失败');
      return;
    }
    const { added = 0, removed = 0, addedList = [], duplicateList = [], failedList = [] } = result;
    syncDiffResult.value = { added, removed, addedList, duplicateList, failedList };
    if (removed > 0 || addedList.length > 0) {
      ElMessage.success(`已与磁盘同步：删除 ${removed} 条，成功新增 ${addedList.length} 条${duplicateList.length > 0 ? `，重复 ${duplicateList.length} 条` : ''}${failedList.length > 0 ? `，失败 ${failedList.length} 条` : ''}`);
    } else if (duplicateList.length > 0) {
      ElMessage.warning(`有 ${duplicateList.length} 条重复数据（库中已存在同番号），请查看下方列表`);
    } else if (failedList.length > 0) {
      ElMessage.warning(`同步完成：失败 ${failedList.length} 条，请查看下方失败列表`);
    } else {
      ElMessage.info('数据已与磁盘一致，无需更新');
    }
  } catch (error) {
    console.error('仅扫描新增或修改失败:', error);
    ElMessage.error('执行失败: ' + (error?.message || '未知错误'));
  } finally {
    syncDiffLoading.value = false;
    syncDiffProgress.value = { phase: 'done', current: 0, total: 0, message: '', percentage: 100 };
  }
};

const scanData = async () => {
  try {
    scanning.value = true;
    // 重置进度
    scanProgress.value = {
      current: 0,
      total: 0,
      success: 0,
      failed: 0,
      percentage: 0,
      status: null
    };
    
    ElMessage.info('开始扫描数据文件夹，请稍候...');
    
    const result = await window.electronAPI.system.scan();
    if (result && result.success) {
      // 更新最终进度
      scanProgress.value.percentage = 100;
      scanProgress.value.status = result.failed > 0 ? 'exception' : 'success';
      
      // 弹窗提示结果
      await ElMessageBox.alert(
        `扫描完成！\n总计: ${result.total}\n成功: ${result.successCount ?? result.success}\n失败: ${result.failed}`,
        '扫描完成',
        {
          confirmButtonText: '确定',
          type: result.failed > 0 ? 'warning' : 'success'
        }
      );
      // 若有识别失败的 NFO，弹出失败列表
      const failedList = result.failedList || [];
      if (failedList.length > 0) {
        const failMsg = failedList
          .map((f, i) => `${i + 1}. ${f.path}\n   原因：${f.reason}`)
          .join('\n\n');
        await ElMessageBox.alert(
          failMsg,
          `识别失败的 NFO 文件（共 ${failedList.length} 个）`,
          {
            confirmButtonText: '确定',
            type: 'warning',
            customClass: 'scan-failed-list-dialog'
          }
        );
      }
    } else {
      scanProgress.value.status = 'exception';
      ElMessage.error('扫描失败: ' + (result?.message || '未知错误'));
    }
  } catch (error) {
    console.error('扫描失败:', error);
    scanProgress.value.status = 'exception';
    ElMessage.error('扫描失败: ' + error.message);
  } finally {
    // 延迟重置，让用户看到最终结果
    setTimeout(() => {
      scanning.value = false;
      if (scanProgress.value.status !== 'exception') {
        // 3秒后重置进度（成功时）
        setTimeout(() => {
          scanProgress.value = {
            current: 0,
            total: 0,
            success: 0,
            failed: 0,
            percentage: 0,
            status: null
          };
        }, 3000);
      }
    }, 1000);
  }
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
  loadDataPaths();
  loadFilterPlayable();

  // 监听增量同步进度（仅在本页触发的增量扫描时更新 UI）
  if (window.electronAPI?.system?.onStartupSyncProgress) {
    window.electronAPI.system.onStartupSyncProgress((data) => {
      if (!syncDiffLoading.value) return;
      const total = data.total || 0;
      const current = data.current || 0;
      syncDiffProgress.value = {
        phase: data.phase || '',
        current,
        total,
        message: data.message || '',
        percentage: total > 0 ? Math.round((current / total) * 100) : (data.phase === 'done' ? 100 : 0)
      };
    });
  }

  // 监听扫描进度事件（必须在组件挂载时设置，确保能接收到事件）
  if (window.electronAPI?.system?.onScanProgress) {
    window.electronAPI.system.onScanProgress((progress) => {
      console.log('收到扫描进度:', progress);
      scanProgress.value = {
        current: progress.current || 0,
        total: progress.total || 0,
        success: progress.success || 0,
        failed: progress.failed || 0,
        percentage: progress.percentage || 0,
        status: (progress.failed > 0) ? 'exception' : null
      };
    });
  }
  
  // 监听扫描完成事件
  if (window.electronAPI?.system?.onScanCompleted) {
    window.electronAPI.system.onScanCompleted((result) => {
      console.log('扫描完成:', result);
      scanProgress.value.percentage = 100;
      scanProgress.value.status = result.failed > 0 ? 'exception' : 'success';
      scanProgress.value.current = result.total || scanProgress.value.total;
      scanProgress.value.success = result.success || 0;
      scanProgress.value.failed = result.failed || 0;
    });
  }
  
  // 监听扫描错误事件
  if (window.electronAPI?.system?.onScanError) {
    window.electronAPI.system.onScanError((error) => {
      console.error('扫描错误:', error);
      scanProgress.value.status = 'exception';
      ElMessageBox.alert(
        `扫描过程中出现错误：\n${error}`,
        '扫描错误',
        {
          confirmButtonText: '确定',
          type: 'error'
        }
      );
    });
  }
});
</script>

<style scoped>
.settings {
  width: 100%;
  height: 100%;
}

.el-header {
  background-color: #409eff;
  color: white;
  display: flex;
  align-items: center;
  padding: 0 20px;
}

.sync-diff-result {
  font-size: 13px;
}
.sync-diff-list {
  margin: 8px 0 0;
  padding-left: 18px;
  max-height: 200px;
  overflow-y: auto;
}
.sync-diff-list li {
  margin: 4px 0;
  word-break: break-all;
}
.sync-diff-failed li {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sync-diff-failed .path {
  color: var(--el-text-color-regular);
}
.sync-diff-failed .reason {
  font-size: 12px;
  color: var(--el-color-danger);
}
</style>
<style>
/* 识别失败列表弹窗：可滚动、保留换行 */
.scan-failed-list-dialog .el-message-box__content {
  max-height: 60vh;
  overflow-y: auto;
  white-space: pre-wrap;
}
</style>
