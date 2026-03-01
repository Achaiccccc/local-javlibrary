/**
 * 列表页全局参数（分页条数、排序、视图模式）
 * 任意列表页修改后，所有列表页保持一致；currentPage 由各列表通过 pageState 单独维护
 */
import { defineStore } from 'pinia';

const STORAGE_KEY = 'javlibrary_list_params';

const defaultState = () => ({
  pageSize: 20,
  sortBy: 'premiered-desc',
  viewMode: 'thumbnail' // 'text' | 'thumbnail'
});

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...defaultState(), ...parsed };
    }
  } catch (e) {
    console.warn('listParamsStore: loadFromStorage failed', e);
  }
  return defaultState();
}

function saveToStorage(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      pageSize: state.pageSize,
      sortBy: state.sortBy,
      viewMode: state.viewMode
    }));
  } catch (e) {
    console.warn('listParamsStore: saveToStorage failed', e);
  }
}

export const useListParamsStore = defineStore('listParams', {
  state: () => loadFromStorage(),
  actions: {
    setPageSize(v) {
      this.pageSize = v;
      saveToStorage(this.$state);
    },
    setSortBy(v) {
      this.sortBy = v;
      saveToStorage(this.$state);
    },
    setViewMode(v) {
      this.viewMode = v;
      saveToStorage(this.$state);
    }
  }
});
