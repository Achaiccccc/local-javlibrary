/**
 * 全局图片加载管理器
 * 支持优先级控制和暂停/恢复机制
 */

// 全局状态
let isPaused = false; // 是否暂停后台加载
let currentLoadingCount = 0; // 当前正在加载的图片数量
const maxConcurrentLoads = 5; // 最多同时加载5张图片
const backgroundQueue = []; // 后台加载队列
const priorityQueue = []; // 优先级队列（用户请求的图片）

/**
 * 图片缓存 key：同一相对路径在不同 data 根下需区分，避免多数据路径时封面互相覆盖
 * @param {string} posterPath - 相对路径
 * @param {number} dataPathIndex - 数据路径索引
 * @returns {string}
 */
export function getImageCacheKey(posterPath, dataPathIndex = 0) {
  return `${dataPathIndex}:${posterPath || ''}`;
}

/**
 * 暂停后台图片加载
 */
export function pauseBackgroundLoading() {
  isPaused = true;
  console.log('已暂停后台图片加载');
}

/**
 * 恢复后台图片加载
 */
export function resumeBackgroundLoading() {
  if (isPaused) {
    isPaused = false;
    console.log('已恢复后台图片加载');
    // 恢复后立即处理队列
    setTimeout(() => {
      processQueue();
    }, 100); // 延迟一点，确保状态已更新
  }
}

/**
 * 加载图片（带优先级）
 * @param {string} posterPath - 图片路径
 * @param {number} dataPathIndex - 数据路径索引
 * @param {boolean} isPriority - 是否为优先级请求（用户操作触发的）
 * @param {Object} imageCache - 图片缓存对象
 * @returns {Promise<string|null>} - 返回图片URL或null
 */
export async function loadImage(posterPath, dataPathIndex = 0, isPriority = false, imageCache = {}) {
  const cacheKey = getImageCacheKey(posterPath, dataPathIndex);
  if (!posterPath || imageCache[cacheKey]) {
    return imageCache[cacheKey] || null;
  }
  
  // 如果是优先级请求，立即处理（不受暂停和并发限制影响）
  if (isPriority) {
    // 优先级请求直接调用 API，不经过队列
    try {
      const imageUrl = await window.electronAPI?.movies?.getImage?.(posterPath, dataPathIndex);
      if (imageUrl) {
        imageCache[cacheKey] = imageUrl;
        return imageUrl;
      }
      return null;
    } catch (error) {
      console.error('加载图片失败:', error);
      return null;
    }
  }
  
  // 如果是后台加载且已暂停，加入队列
  if (isPaused) {
    backgroundQueue.push({ posterPath, dataPathIndex, imageCache });
    return null;
  }
  
  // 如果正在加载的图片太多，加入队列
  if (currentLoadingCount >= maxConcurrentLoads) {
    backgroundQueue.push({ posterPath, dataPathIndex, imageCache });
    return null;
  }
  
  // 立即加载
  return await loadImageImmediate(posterPath, dataPathIndex, imageCache);
}

/**
 * 立即加载图片（内部方法）
 */
async function loadImageImmediate(posterPath, dataPathIndex, imageCache) {
  const cacheKey = getImageCacheKey(posterPath, dataPathIndex);
  currentLoadingCount++;
  try {
    const imageUrl = await window.electronAPI?.movies?.getImage?.(posterPath, dataPathIndex);
    if (imageUrl) {
      imageCache[cacheKey] = imageUrl;
      return imageUrl;
    }
    return null;
  } catch (error) {
    console.error('加载图片失败:', error);
    return null;
  } finally {
    currentLoadingCount--;
    // 处理队列中的下一个图片
    processQueue();
  }
}

/**
 * 处理队列中的图片
 */
function processQueue() {
  // 如果已暂停或正在加载的图片太多，不处理
  if (isPaused || currentLoadingCount >= maxConcurrentLoads) {
    return;
  }
  
  // 处理后台队列
  if (backgroundQueue.length > 0) {
    const next = backgroundQueue.shift();
    if (next) {
      loadImageImmediate(next.posterPath, next.dataPathIndex, next.imageCache)
        .then(() => {
          // 延迟一点再处理下一个，避免阻塞
          setTimeout(processQueue, 50);
        })
        .catch(() => {
          // 即使失败也继续处理队列
          setTimeout(processQueue, 50);
        });
    }
  }
}

/**
 * 批量加载图片（后台加载）
 * @param {Array} movies - 影片数组
 * @param {Object} imageCache - 图片缓存对象
 * @param {number} batchSize - 每批加载数量
 */
export function loadImagesBatch(movies, imageCache, batchSize = 20) {
  const moviesToLoad = movies.filter(movie =>
    movie.poster_path && !imageCache[getImageCacheKey(movie.poster_path, movie.data_path_index)]
  );
  
  if (moviesToLoad.length === 0) {
    return;
  }
  
  // 立即加载第一批
  const firstBatch = moviesToLoad.slice(0, batchSize);
  for (const movie of firstBatch) {
    loadImage(movie.poster_path, movie.data_path_index, false, imageCache);
  }
  
  // 在后台分批加载剩余的图片
  if (moviesToLoad.length > batchSize) {
    setTimeout(() => {
      const remainingMovies = moviesToLoad.slice(batchSize);
      let currentIndex = 0;
      
      const loadNextBatch = () => {
        // 如果已暂停，停止加载
        if (isPaused) {
          return;
        }
        
        const batch = remainingMovies.slice(currentIndex, currentIndex + batchSize);
        for (const movie of batch) {
          loadImage(movie.poster_path, movie.data_path_index, false, imageCache);
        }
        currentIndex += batchSize;
        
        // 如果还有剩余且未暂停，继续加载下一批
        if (currentIndex < remainingMovies.length && !isPaused) {
          setTimeout(loadNextBatch, 100);
        }
      };
      
      // 延迟500ms后开始加载第二批
      setTimeout(loadNextBatch, 500);
    }, 100);
  }
}

/**
 * 清空队列
 */
export function clearQueue() {
  backgroundQueue.length = 0;
  priorityQueue.length = 0;
}
