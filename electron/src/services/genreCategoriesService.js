const { app } = require('electron');
const fs = require('fs-extra');
const path = require('path');

const FILENAME = process.env.NODE_ENV === 'development' ? 'genre-categories-dev.json' : 'genre-categories.json';

function getFilePath() {
  return path.join(app.getPath('userData'), FILENAME);
}

function ensureFile() {
  const filePath = getFilePath();
  if (!fs.existsSync(filePath)) {
    const data = { categories: [] };
    fs.ensureDirSync(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}

function readRaw() {
  ensureFile();
  const raw = fs.readFileSync(getFilePath(), 'utf-8');
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data.categories)) data.categories = [];
    return data;
  } catch (e) {
    const data = { categories: [] };
    fs.writeFileSync(getFilePath(), JSON.stringify(data, null, 2), 'utf-8');
    return data;
  }
}

function writeRaw(data) {
  const filePath = getFilePath();
  fs.ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function validateCategories(categories) {
  if (!Array.isArray(categories)) {
    throw new Error('分类配置必须是数组');
  }
  if (categories.length === 0) {
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
      throw new Error(`一级分类名称重复: ${name}`);
    }
    categoryNames.add(name);

    if (!Array.isArray(cat.genres)) {
      continue;
    }
    const localGenres = new Set();
    for (const g of cat.genres) {
      const gName = typeof g === 'string' ? g.trim() : '';
      if (!gName) {
        throw new Error(`分类「${name}」中存在空的二级分类名称`);
      }
      if (localGenres.has(gName)) {
        throw new Error(`分类「${name}」中二级分类名称重复: ${gName}`);
      }
      localGenres.add(gName);
      if (genreNames.has(gName)) {
        throw new Error(`二级分类名称全局重复: ${gName}`);
      }
      genreNames.add(gName);
    }
  }
}

function getCategories() {
  const data = readRaw();
  return Array.isArray(data.categories) ? data.categories : [];
}

function saveCategories(categories) {
  validateCategories(categories);
  writeRaw({ categories });
}

module.exports = {
  getCategories,
  saveCategories
};

