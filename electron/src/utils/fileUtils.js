const path = require('path');
const fs = require('fs-extra');

/**
 * 获取文件夹中的所有NFO文件
 * @param {string} folderPath - 文件夹路径
 * @returns {Promise<string[]>} - NFO文件路径数组
 */
async function getNfoFiles(folderPath) {
  const files = await fs.readdir(folderPath);
  return files
    .filter(file => path.extname(file).toLowerCase() === '.nfo')
    .map(file => path.join(folderPath, file));
}

/**
 * 获取作品文件夹中的图片路径
 * @param {string} folderPath - 作品文件夹路径
 * @returns {Promise<{poster: string|null, fanart: string|null}>} - 图片路径
 */
async function getImagePaths(folderPath) {
  const files = await fs.readdir(folderPath);
  
  let poster = null;
  let fanart = null;

  // 支持的图片扩展名
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
  // 使用优先级控制：ps/pl 命名优先，其次是含 poster/fanart 关键词的命名（支持刮削器生成的 番号-分类-poster.jpg 等）
  // poster: 2 = *ps.*, 1 = 文件名含 poster, 0 = 未匹配
  // fanart: 2 = *pl.*, 1 = 文件名含 fanart, 0 = 未匹配
  let posterPriority = 0;
  let fanartPriority = 0;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!imageExtensions.includes(ext)) {
      continue;
    }

    const lowerFile = file.toLowerCase();
    const nameWithoutExt = path.basename(lowerFile, ext);

    // 封面图：优先识别 *ps.(jpg|png|webp...)，其次为文件名含 poster 关键词（如 MKMP-393-C-poster）
    if (nameWithoutExt.endsWith('ps')) {
      if (posterPriority < 2) {
        posterPriority = 2;
        poster = path.join(folderPath, file);
      }
    } else if (nameWithoutExt.includes('poster')) {
      if (posterPriority < 1) {
        posterPriority = 1;
        poster = path.join(folderPath, file);
      }
    }

    // 海报图 / 背景图：优先识别 *pl.(jpg|png|webp...)，其次为文件名含 fanart 关键词（如 MKMP-393-C-fanart）
    if (nameWithoutExt.endsWith('pl')) {
      if (fanartPriority < 2) {
        fanartPriority = 2;
        fanart = path.join(folderPath, file);
      }
    } else if (nameWithoutExt.includes('fanart')) {
      if (fanartPriority < 1) {
        fanartPriority = 1;
        fanart = path.join(folderPath, file);
      }
    }
  }
  
  return { poster, fanart };
}

/**
 * 检查文件夹是否为作品文件夹（包含至少一个 .nfo 文件）
 * @param {string} folderPath - 文件夹路径
 * @returns {Promise<boolean>} - 是否为作品文件夹
 */
async function isMovieFolder(folderPath) {
  try {
    const nfoFiles = await getNfoFiles(folderPath);
    return nfoFiles.length > 0;
  } catch {
    return false;
  }
}

/**
 * 读取图片文件并转换为base64
 * @param {string} imagePath - 图片路径
 * @returns {Promise<string>} - base64字符串
 */
async function readImageAsBase64(imagePath) {
  try {
    const buffer = await fs.readFile(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.error(`读取图片失败: ${imagePath}`, error);
    return null;
  }
}

/**
 * 检查文件夹中是否有视频文件
 * @param {string} folderPath - 文件夹路径
 * @returns {Promise<{playable: boolean, videoPath: string|null}>} - 是否可播放及视频文件路径
 */
async function checkVideoFile(folderPath) {
  try {
    const files = await fs.readdir(folderPath);
    // 支持的视频格式
    const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.ts', '.mpg', '.mpeg'];
    
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (videoExtensions.includes(ext)) {
        const videoPath = path.join(folderPath, file);
        // 检查文件是否存在且可读
        try {
          await fs.access(videoPath, fs.constants.F_OK);
          return { playable: true, videoPath: videoPath };
        } catch {
          continue;
        }
      }
    }
    
    return { playable: false, videoPath: null };
  } catch (error) {
    console.error(`检查视频文件失败: ${folderPath}`, error);
    return { playable: false, videoPath: null };
  }
}

module.exports = {
  getNfoFiles,
  getImagePaths,
  isMovieFolder,
  readImageAsBase64,
  checkVideoFile
};
