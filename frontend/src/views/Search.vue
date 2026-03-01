<template>
  <div class="search">
    <el-container>
      <el-header>
        <h1 style="margin: 0;">搜索</h1>
      </el-header>
      <el-main>
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
import { ref, onMounted, onActivated } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useScanStore } from '../stores/scanStore';

const router = useRouter();
const scanStore = useScanStore();
const lastRefreshedDataVersion = ref(0);
const activeTab = ref('simple');
const searching = ref(false);

const simpleForm = ref({
  keyword: ''
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

const handleSimpleSearch = async () => {
  if (!simpleForm.value.keyword || simpleForm.value.keyword.trim() === '') {
    ElMessage.warning('请输入搜索关键词');
    return;
  }
  
  try {
    searching.value = true;
    const result = await window.electronAPI.search.simple(simpleForm.value.keyword.trim());
    
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
            type: 'simple',
            keyword: simpleForm.value.keyword.trim(),
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

.el-header {
  background-color: #409eff;
  color: white;
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
</style>
