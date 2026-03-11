<template>
  <div class="genre-list">
    <el-container>
      <el-header class="page-header">
          <div class="header-content">
            <div class="header-left">
              <el-button @click="goBack" icon="ArrowLeft">返回</el-button>
              <h1 class="header-title">分类列表</h1>
            </div>
            <div class="header-right">
              <el-button type="primary" plain class="header-action-button" @click="openEditDialog">编辑当前分类列表</el-button>
              <el-button plain class="header-action-button" @click="handleImportDefault">导入默认数据</el-button>
              <ThemeSwitch />
            </div>
          </div>
      </el-header>
      <el-main class="page-theme-bg">
        <el-card>
          <div v-if="loading">加载中...</div>
          <div v-else class="genres-container">
            <div
              v-for="category in groupedGenres"
              :key="category.name"
              class="category-section"
            >
              <h2 class="category-title">{{ category.name }}</h2>
              <div class="genres-grid">
                <el-card
                  v-for="genre in category.genres"
                  :key="genre.name"
                  class="genre-card"
                  :class="{ 'genre-disabled': !genre.inDatabase }"
                  :shadow="genre.inDatabase ? 'hover' : 'never'"
                  @click="genre.inDatabase && goToGenreDetail(genre.id, genre.name)"
                >
                  <div class="genre-info">
                    <div class="genre-name" :class="{ 'genre-name-disabled': !genre.inDatabase }">
                      {{ genre.name }}
                    </div>
                    <div v-if="genre.inDatabase" class="genre-meta">
                      (<span :class="{ 'playable-count': genre.playableCount > 0 }">{{ genre.playableCount }}</span>/{{ genre.totalCount }})
                    </div>
                    <div v-else class="genre-meta genre-meta-disabled">暂无数据</div>
                  </div>
                </el-card>
              </div>
            </div>
          </div>
        </el-card>
      </el-main>
    </el-container>

    <el-dialog
      v-model="editDialogVisible"
      title="编辑分类列表"
      width="640px"
      :close-on-click-modal="false"
    >
      <div class="edit-dialog-body">
        <div class="tree-ops">
          <el-button size="small" type="primary" @click="addRootCategory">新增大类</el-button>
          <el-button size="small" @click="addChildGenre" :disabled="!currentNode || currentNode.parent">新增子分类</el-button>
          <el-button size="small" type="danger" :disabled="!currentNode" @click="removeCurrentNode">删除选中</el-button>
        </div>
        <el-tree
          ref="treeRef"
          class="genre-tree"
          :data="treeData"
          node-key="id"
          default-expand-all
          highlight-current
          :expand-on-click-node="false"
          @current-change="handleCurrentChange"
        >
          <template #default="{ data }">
            <el-input
              v-model="data.label"
              size="small"
              class="node-input"
              :placeholder="data.parent ? '子分类名称' : '大类名称'"
              @blur="trimNodeLabel(data)"
            />
          </template>
        </el-tree>
      </div>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="editDialogVisible = false">取 消</el-button>
          <el-button type="primary" @click="saveTree">保 存</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'GenreCatalog' });
import { ref, onMounted, onActivated, computed, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { defaultGenreCategories } from '../config/genres';
import { useScanStore } from '../stores/scanStore';
import { useGenreCategoriesStore } from '../stores/genreCategoriesStore';
import ThemeSwitch from '../components/ThemeSwitch.vue';

const router = useRouter();
const route = useRoute();
const scanStore = useScanStore();
const genreStore = useGenreCategoriesStore();
const lastRefreshedDataVersion = ref(0);
const loading = ref(true);
const dbGenres = ref([]); // 数据库中的分类

const editDialogVisible = ref(false);
const treeData = ref([]);
const treeRef = ref(null);
const currentNode = ref(null);

function buildTreeFromCategories(categories) {
  const now = Date.now();
  return categories.map((cat, i) => ({
    id: `cat-${i}-${now}`,
    label: cat.name,
    children: (cat.genres || []).map((g, j) => ({
      id: `cat-${i}-g-${j}-${now}`,
      label: g,
      parent: true // 标记为子节点，简化判断
    }))
  }));
}

function buildCategoriesFromTree(nodes) {
  return nodes
    .map(node => ({
      name: (node.label || '').trim(),
      genres: (node.children || []).map(ch => (ch.label || '').trim()).filter(Boolean)
    }))
    .filter(cat => cat.name);
}

const loadGenres = async () => {
  try {
    loading.value = true;
    const result = await window.electronAPI.genres.getList();
    if (result.success) {
      dbGenres.value = result.data || [];
      lastRefreshedDataVersion.value = scanStore.dataVersion;
    } else {
      ElMessage.error('加载分类列表失败: ' + (result.message || '未知错误'));
    }
  } catch (error) {
    console.error('加载分类列表失败:', error);
    ElMessage.error('加载分类列表失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

// 将标准/配置分类与数据库中的分类合并
const groupedGenres = computed(() => {
  // 创建数据库分类的映射（按名称）
  const dbGenreMap = new Map();
  dbGenres.value.forEach(genre => {
    dbGenreMap.set(genre.name, genre);
  });

  const categories =
    (genreStore.categories && genreStore.categories.length > 0)
      ? genreStore.categories
      : defaultGenreCategories;

  // 处理每个大类
  return categories.map(category => {
    const genres = category.genres.map(genreName => {
      const dbGenre = dbGenreMap.get(genreName);
      if (dbGenre) {
        // 数据库中存在该分类
        return {
          name: genreName,
          id: dbGenre.id,
          inDatabase: true,
          playableCount: dbGenre.playableCount || 0,
          totalCount: dbGenre.totalCount || 0
        };
      } else {
        // 数据库中不存在该分类
        return {
          name: genreName,
          id: null,
          inDatabase: false,
          playableCount: 0,
          totalCount: 0
        };
      }
    });

    return {
      name: category.name,
      genres
    };
  });
});

const goToGenreDetail = async (genreId, genreName) => {
  if (genreId) {
    // 数据库中存在该分类，直接跳转
    router.push(`/genre/${genreId}`);
  } else {
    // 数据库中不存在，尝试创建或查找
    try {
      const result = await window.electronAPI.genres.getOrCreateByName(genreName);
      if (result.success && result.data) {
        router.push(`/genre/${result.data.id}`);
      } else {
        ElMessage.warning(`分类"${genreName}"暂无数据`);
      }
    } catch (error) {
      console.error('创建分类失败:', error);
      ElMessage.warning(`分类"${genreName}"暂无数据`);
    }
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

onActivated(() => {
  if (scanStore.dataVersion > lastRefreshedDataVersion.value) {
    lastRefreshedDataVersion.value = scanStore.dataVersion;
    loadGenres();
  }
});

onMounted(async () => {
  await genreStore.load();
  loadGenres();
});

watch(
  () => route.fullPath,
  () => {
    editDialogVisible.value = false;
  }
);

function openEditDialog() {
  const categories =
    (genreStore.categories && genreStore.categories.length > 0)
      ? genreStore.categories
      : defaultGenreCategories;
  treeData.value = buildTreeFromCategories(categories);
  currentNode.value = null;
  editDialogVisible.value = true;
}

async function handleImportDefault() {
  try {
    await genreStore.appendDefault();
    ElMessage.success('已导入默认分类数据');
  } catch (e) {
    console.error(e);
    ElMessage.error(e?.message || '导入默认分类数据失败');
  }
}

function handleCurrentChange(data) {
  currentNode.value = data || null;
}

function addRootCategory() {
  const now = Date.now();
  treeData.value.push({
    id: `cat-new-${now}-${treeData.value.length}`,
    label: '新建分类',
    children: []
  });
}

function addChildGenre() {
  if (!currentNode.value) return;
  // 仅允许在根节点下添加子分类（最多两层）
  const rootNode = treeData.value.find(n => n.id === currentNode.value.id);
  if (rootNode) {
    if (!Array.isArray(rootNode.children)) rootNode.children = [];
    rootNode.children.push({
      id: `g-${Date.now()}-${rootNode.children.length}`,
      label: '新建子分类',
      parent: true
    });
  }
}

function removeCurrentNode() {
  if (!currentNode.value) return;
  const id = currentNode.value.id;
  const roots = treeData.value;
  const rootIndex = roots.findIndex(n => n.id === id);
  if (rootIndex !== -1) {
    roots.splice(rootIndex, 1);
    currentNode.value = null;
    return;
  }
  for (const root of roots) {
    if (!Array.isArray(root.children)) continue;
    const idx = root.children.findIndex(ch => ch.id === id);
    if (idx !== -1) {
      root.children.splice(idx, 1);
      currentNode.value = null;
      break;
    }
  }
}

function trimNodeLabel(node) {
  if (!node || typeof node.label !== 'string') return;
  node.label = node.label.trim();
}

async function saveTree() {
  try {
    const categories = buildCategoriesFromTree(treeData.value);
    await genreStore.save(categories);
    ElMessage.success('分类配置已保存');
    editDialogVisible.value = false;
  } catch (e) {
    console.error(e);
    ElMessage.error(e?.message || '保存分类配置失败');
  }
}
</script>

<style scoped>
.genre-list {
  width: 100%;
  min-height: 100%;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.header-action-button {
  min-width: 130px;
  padding: 8px 16px;
  font-size: 14px;
}
.header-left { display: flex; align-items: center; }
.header-title { margin: 0; margin-left: 16px; }
.page-header {
  background-color: var(--header-bg);
  color: var(--title-color);
  display: flex;
  align-items: center;
  padding: 0 20px;
}

.genres-container {
  padding: 16px 0;
}

.category-section {
  margin-bottom: 32px;
}

.category-title {
  font-size: 20px;
  font-weight: bold;
  color: var(--content-title-color);
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--el-color-primary);
}

.genres-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  gap: 6px;
  margin-bottom: 24px;
}

.genre-card {
  cursor: pointer;
  transition: transform 0.2s, opacity 0.2s;
}

.genre-card:hover:not(.genre-disabled) {
  transform: translateY(-4px);
}

.genre-disabled {
  cursor: not-allowed;
  opacity: 0.6;
  background-color: var(--card-disabled-bg);
}

.genre-info {
  text-align: center;
  padding: 4px;
}

.genre-name {
  font-size: 12px;
  font-weight: bold;
  margin-bottom: 2px;
  color: var(--content-title-color);
}

.genre-name-disabled {
  color: var(--content-subtitle-color);
}

.genre-meta {
  font-size: 10px;
  color: var(--content-subtitle-color);
}

.genre-meta-disabled {
  color: var(--content-subtitle-color);
  opacity: 0.8;
}

.playable-count {
  color: #67c23a;
  font-weight: bold;
}

/* 当可播放条数为0时，不应用绿色样式 */
.genre-meta span:not(.playable-count) {
  color: inherit;
  font-weight: normal;
}

.edit-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tree-ops {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.genre-tree {
  max-height: 400px;
  overflow: auto;
  border: 1px solid var(--el-border-color-light);
  border-radius: 4px;
  padding: 8px;
}

.node-input {
  width: 220px;
}
</style>
