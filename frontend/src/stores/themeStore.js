/**
 * 主题状态：日间/夜间，持久化到 localStorage，便于扩展更多主题
 * 切换时设置 document.documentElement 的 data-theme 与 class="dark"（Element Plus 暗色）
 */
import { defineStore } from 'pinia';

const STORAGE_KEY = 'javlibrary_theme';

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'dark' || raw === 'light') return raw;
  } catch (e) {
    console.warn('themeStore: loadFromStorage failed', e);
  }
  return 'light';
}

function saveToStorage(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch (e) {
    console.warn('themeStore: saveToStorage failed', e);
  }
}

function applyToDocument(theme) {
  const root = document.documentElement;
  if (!root) return;
  root.setAttribute('data-theme', theme);
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

export const useThemeStore = defineStore('theme', {
  state: () => ({ theme: loadFromStorage() }),
  getters: {
    isDark: (state) => state.theme === 'dark'
  },
  actions: {
    setTheme(value) {
      const theme = value === 'dark' ? 'dark' : 'light';
      this.theme = theme;
      saveToStorage(theme);
      applyToDocument(theme);
    },
    /** 将当前主题应用到 document（用于应用启动时恢复） */
    applyToDocument() {
      applyToDocument(this.theme);
    }
  }
});
