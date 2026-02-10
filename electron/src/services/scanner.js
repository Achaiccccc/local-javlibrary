const fs = require('fs-extra');
const path = require('path');
const glob = require('fast-glob');
const { parseNfoFile } = require('../utils/xmlParser');
const { getImagePaths, isMovieFolder, checkVideoFile } = require('../utils/fileUtils');
const { getSequelize } = require('../config/database');

/**
 * 扫描data文件夹，解析所有NFO文件并导入数据库
 * @param {string} dataPath - data文件夹路径
 * @param {number} dataPathIndex - 数据路径索引（用于多路径支持）
 * @param {Function} progressCallback - 进度回调函数 (current, total, success, failed) => void
 * @param {boolean} clearTables - 是否清空表数据（默认false，只在第一次扫描时清空）
 * @returns {Promise<{total: number, success: number, failed: number}>} - 扫描结果
 */
async function scanDataFolder(dataPath, dataPathIndex = 0, progressCallback = null, clearTables = false) {
  const sequelize = getSequelize();
  
  // 检查数据库是否已初始化
  if (!sequelize || !sequelize.models) {
    throw new Error('数据库未初始化，请等待数据库初始化完成');
  }
  
  const Actor = sequelize.models.Actor;
  const ActorFromNfo = sequelize.models.ActorFromNfo;
  const Movie = sequelize.models.Movie;
  const Genre = sequelize.models.Genre;
  const Studio = sequelize.models.Studio;
  const Director = sequelize.models.Director;
  
  // 检查模型是否存在
  if (!Actor || !ActorFromNfo || !Movie || !Genre || !Studio || !Director) {
    throw new Error('数据库模型未加载，请等待数据库初始化完成');
  }

  // 在扫描开始前，如果需要则清空所有表数据（只在第一次扫描时清空）
  if (clearTables) {
    console.log('开始清空所有表数据...');
    try {
    // 先禁用外键约束，以便可以按任意顺序删除
    await sequelize.query('PRAGMA foreign_keys = OFF');
    
    // 按照依赖关系顺序删除数据（先删除关联表，再删除主表）
    const MovieActor = sequelize.models.MovieActor;
    const MovieActorFromNfo = sequelize.models.MovieActorFromNfo;
    const MovieGenre = sequelize.models.MovieGenre;
    
    // 删除关联表数据
    if (MovieActor) {
      await MovieActor.destroy({ where: {}, truncate: true, cascade: true });
      console.log('已清空 movie_actors 表');
    }
    if (MovieActorFromNfo) {
      await MovieActorFromNfo.destroy({ where: {}, truncate: true, cascade: true });
      console.log('已清空 movie_actors_from_nfo 表');
    }
    if (MovieGenre) {
      await MovieGenre.destroy({ where: {}, truncate: true, cascade: true });
      console.log('已清空 movie_genres 表');
    }
    
    // 删除主表数据
    await Movie.destroy({ where: {}, truncate: true, cascade: true });
    console.log('已清空 movies 表');
    
    await Actor.destroy({ where: {}, truncate: true, cascade: true });
    console.log('已清空 actors 表');
    
    await ActorFromNfo.destroy({ where: {}, truncate: true, cascade: true });
    console.log('已清空 actors_from_nfo 表');
    
    await Genre.destroy({ where: {}, truncate: true, cascade: true });
    console.log('已清空 genres 表');
    
    await Studio.destroy({ where: {}, truncate: true, cascade: true });
    console.log('已清空 studios 表');
    
    await Director.destroy({ where: {}, truncate: true, cascade: true });
    console.log('已清空 directors 表');
    
      // 重新启用外键约束
      await sequelize.query('PRAGMA foreign_keys = ON');
      console.log('所有表数据已清空，准备重新扫描...');
    } catch (clearError) {
      console.error('清空表数据时出错:', clearError);
      // 如果清空失败，尝试使用 DELETE 方式
      try {
        console.log('尝试使用 DELETE 方式清空数据...');
        await sequelize.query('DELETE FROM movie_actors');
        await sequelize.query('DELETE FROM movie_actors_from_nfo');
        await sequelize.query('DELETE FROM movie_genres');
        await sequelize.query('DELETE FROM movies');
        await sequelize.query('DELETE FROM actors');
        await sequelize.query('DELETE FROM actors_from_nfo');
        await sequelize.query('DELETE FROM genres');
        await sequelize.query('DELETE FROM studios');
        await sequelize.query('DELETE FROM directors');
        console.log('使用 DELETE 方式清空数据成功');
      } catch (deleteError) {
        console.error('清空数据失败:', deleteError);
        throw new Error('无法清空数据库表数据: ' + deleteError.message);
      }
    }
  } else {
    console.log(`扫描路径 ${dataPathIndex + 1}，不清空数据（追加模式）`);
  }

  let total = 0;
  let success = 0;
  let failed = 0;
  let processed = 0;

  try {
    // 先统计总数（用于进度计算）
    console.log('开始统计文件总数...');
    // 通过 .nfo 后缀匹配所有 NFO 文件，而不限制文件名
    const allNfoFiles = await glob('**/*.nfo', {
      cwd: dataPath,
      absolute: true,
      ignore: ['**/node_modules/**']
    });
    
    total = allNfoFiles.length;
    console.log(`找到 ${total} 个NFO文件，开始处理...`);
    
    for (const nfoPath of allNfoFiles) {
      const movieFolderPath = path.dirname(nfoPath);
      
      try {
        // 解析NFO文件
        const movieData = await parseNfoFile(nfoPath);
        
        // 获取图片路径
        const { poster, fanart } = await getImagePaths(movieFolderPath);
        
        // 检查是否有视频文件
        const { playable, videoPath } = await checkVideoFile(movieFolderPath);
        
        // 获取或创建导演（"----" 表示空值）
        let director = null;
        if (movieData.director && movieData.director.trim() !== '' && movieData.director.trim() !== '----') {
          [director] = await Director.findOrCreate({
            where: { name: movieData.director },
            defaults: { name: movieData.director }
          });
        }
        
        // 获取或创建制作商（"----" 表示空值）
        let studio = null;
        if (movieData.studio && movieData.studio.trim() !== '' && movieData.studio.trim() !== '----') {
          [studio] = await Studio.findOrCreate({
            where: { name: movieData.studio },
            defaults: { name: movieData.studio }
          });
        }
        
        // 使用事务确保数据一致性
        const sequelize = getSequelize();
        await sequelize.transaction(async (t) => {
          // 创建或更新影片（如果识别码相同但路径不同，则更新路径信息）
          const [movie, created] = await Movie.findOrCreate({
            where: { code: movieData.code },
            defaults: {
              title: movieData.title,
              code: movieData.code,
              runtime: movieData.runtime,
              premiered: movieData.premiered,
              director_id: director ? director.id : null,
              studio_id: studio ? studio.id : null,
              poster_path: poster ? path.relative(dataPath, poster) : null,
              fanart_path: fanart ? path.relative(dataPath, fanart) : null,
              nfo_path: path.relative(dataPath, nfoPath),
              folder_path: path.relative(dataPath, movieFolderPath),
              playable: playable,
              video_path: videoPath ? path.relative(dataPath, videoPath) : null,
              data_path_index: dataPathIndex
            },
            transaction: t
          });
          
          // 如果不是新创建的，更新数据（包括路径索引）
          if (!created) {
            await movie.update({
              title: movieData.title,
              runtime: movieData.runtime,
              premiered: movieData.premiered,
              director_id: director ? director.id : null,
              studio_id: studio ? studio.id : null,
              poster_path: poster ? path.relative(dataPath, poster) : null,
              fanart_path: fanart ? path.relative(dataPath, fanart) : null,
              nfo_path: path.relative(dataPath, nfoPath),
              folder_path: path.relative(dataPath, movieFolderPath),
              playable: playable,
              video_path: videoPath ? path.relative(dataPath, videoPath) : null,
              data_path_index: dataPathIndex
            }, { transaction: t });
          }
          
          // 先清除旧的关联关系
          await movie.setActorsFromNfo([], { transaction: t });
          await movie.setGenres([], { transaction: t });
          
          // 处理NFO文件中的演员（所有演员数据均来自NFO）
          if (movieData.actors && Array.isArray(movieData.actors)) {
            for (const actorName of movieData.actors) {
              if (!actorName) continue;
              const [nfoActor] = await ActorFromNfo.findOrCreate({
                where: { name: actorName },
                defaults: { name: actorName },
                transaction: t
              });
              await movie.addActorsFromNfo(nfoActor, { transaction: t });
            }
          }
          
          // 处理分类
          if (movieData.genres && Array.isArray(movieData.genres)) {
            for (const genreName of movieData.genres) {
              if (!genreName) continue;
              const [genre] = await Genre.findOrCreate({
                where: { name: genreName },
                defaults: { name: genreName },
                transaction: t
              });
              await movie.addGenre(genre, { transaction: t });
            }
          }
        });
        
        success++;
        processed++;
        
        // 发送进度更新
        if (progressCallback) {
          progressCallback(processed, total, success, failed);
        }
      } catch (error) {
        console.error(`处理作品失败: ${movieFolderPath}`, error);
        failed++;
        processed++;
        
        // 发送进度更新（包含失败）
        if (progressCallback) {
          progressCallback(processed, total, success, failed);
        }
      }
    }
    
    // 由于在扫描开始前已经清空了所有数据，这里不需要再清理
    console.log('扫描完成');
    
    return { total, success, failed };
  } catch (error) {
    console.error('扫描data文件夹失败:', error);
    throw error;
  }
}

module.exports = {
  scanDataFolder
};
