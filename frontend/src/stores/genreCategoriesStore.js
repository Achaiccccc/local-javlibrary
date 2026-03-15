import { defineStore } from 'pinia';
import { defaultGenreCategories } from '../config/genres';

function normalizeCategories(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(cat => ({
    name: typeof cat.name === 'string' ? cat.name.trim() : '',
    genres: Array.isArray(cat.genres)
      ? cat.genres.map(g => (typeof g === 'string' ? g.trim() : '')).filter(Boolean)
      : []
  })).filter(cat => cat.name);
}

function validateCategories(categories) {
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error('至少需要一个一级分类');
  }
  const categoryNames = new Set();
  const genreNames = new Set();

  for (const cat of categories) {
    const name = typeof cat.name === 'string' ? cat.name.trim() : '';
    if (!name) {
      throw new Error('一级分类名称不能为空');
    }
    if (categoryNames.has(name)) {
      throw new Error(`一级分类名称重复：${name}`);
    }
    categoryNames.add(name);

    const localGenres = new Set();
    for (const g of cat.genres || []) {
      const gName = typeof g === 'string' ? g.trim() : '';
      if (!gName) {
        throw new Error(`分类「${name}」中存在空的二级分类名称`);
      }
      if (localGenres.has(gName)) {
        throw new Error(`分类「${name}」中二级分类名称重复：${gName}`);
      }
      localGenres.add(gName);
      if (genreNames.has(gName)) {
        throw new Error(`二级分类名称全局重复：${gName}`);
      }
      genreNames.add(gName);
    }
  }
}

export const useGenreCategoriesStore = defineStore('genreCategories', {
  state: () => ({
    categories: [],
    loaded: false
  }),
  actions: {
    async load() {
      if (this.loaded) return;
      try {
        const result = await window.electronAPI.genreCategories.get();
        const list = normalizeCategories(result?.data || []);
        if (list.length > 0) {
          this.categories = list;
        } else {
          this.categories = normalizeCategories(defaultGenreCategories);
        }
      } catch (e) {
        this.categories = normalizeCategories(defaultGenreCategories);
      } finally {
        this.loaded = true;
      }
    },
    async save(newCategories) {
      const normalized = normalizeCategories(newCategories);
      validateCategories(normalized);
      await window.electronAPI.genreCategories.save(normalized);
      this.categories = normalized;
    },
    async appendDefault() {
      await this.load();
      const base = normalizeCategories(this.categories);
      const defaults = normalizeCategories(defaultGenreCategories);

      const globalGenres = new Set();
      base.forEach(cat => {
        (cat.genres || []).forEach(g => {
          if (g) globalGenres.add(g);
        });
      });

      const categoriesMap = new Map();
      base.forEach(cat => {
        categoriesMap.set(cat.name, { ...cat, genres: [...(cat.genres || [])] });
      });

      defaults.forEach(defCat => {
        let target = categoriesMap.get(defCat.name);
        if (!target) {
          target = { name: defCat.name, genres: [] };
          categoriesMap.set(defCat.name, target);
        }
        (defCat.genres || []).forEach(g => {
          if (!g || globalGenres.has(g)) return;
          target.genres.push(g);
          globalGenres.add(g);
        });
      });

      const merged = Array.from(categoriesMap.values());
      validateCategories(merged);
      await window.electronAPI.genreCategories.save(merged);
      this.categories = merged;
    }
  }
});

