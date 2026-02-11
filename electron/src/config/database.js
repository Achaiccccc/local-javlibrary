const { Sequelize } = require('sequelize');
const path = require('path');
const { app } = require('electron');
const fs = require('fs-extra');

// 数据库文件路径（存储在用户数据目录）
// 在开发环境中使用不同的数据库文件名，避免与生产环境共享数据
const userDataPath = app.getPath('userData');
const dbFileName = process.env.NODE_ENV === 'development' ? 'javlibrary-dev.db' : 'javlibrary.db';
const dbPath = path.join(userDataPath, dbFileName);

// 确保目录存在
fs.ensureDirSync(userDataPath);

// 创建Sequelize实例（使用sqlite3）
// 注意：在开发环境中，如果 sqlite3 未编译，将使用现有的数据库文件
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: console.log, // 临时启用日志以便调试
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  retry: {
    max: 3
  },
  // 设置超时时间
  timeout: 30000
});

// 初始化数据库
async function initDatabase() {
  try {
    console.log('开始连接数据库，路径:', dbPath);
    console.log('数据库文件是否存在:', fs.existsSync(dbPath));
    console.log('用户数据目录:', userDataPath);
    console.log('用户数据目录是否存在:', fs.existsSync(userDataPath));
    
    // 如果数据库文件存在，显示文件大小
    if (fs.existsSync(dbPath)) {
      const stats = fs.statSync(dbPath);
      console.log('数据库文件大小:', (stats.size / 1024).toFixed(2), 'KB');
    }
    
    // 添加超时处理
    const authPromise = sequelize.authenticate();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('数据库连接超时（30秒）')), 30000);
    });
    
    try {
      await Promise.race([authPromise, timeoutPromise]);
      console.log('数据库连接成功');
      
      // 连接成功后，尝试启用 WAL 模式（可选，如果失败不影响使用）
      try {
        await sequelize.query('PRAGMA journal_mode = WAL');
        console.log('WAL 模式已启用');
      } catch (walError) {
        console.warn('启用 WAL 模式失败，使用默认模式:', walError.message);
      }
      // 设置 busy_timeout：锁等待 30 秒，避免扫描时与前端查询冲突导致 SQLITE_BUSY
      try {
        await sequelize.query('PRAGMA busy_timeout = 30000');
        console.log('SQLite busy_timeout 已设置为 30000ms');
      } catch (busyError) {
        console.warn('设置 busy_timeout 失败:', busyError.message);
      }
    } catch (authError) {
      console.error('数据库连接失败:', authError);
      console.error('错误详情:', authError.message);
      if (authError.stack) {
        console.error('错误堆栈:', authError.stack);
      }
      throw authError;
    }
    
    console.log('开始导入模型...');
    // 导入模型（在函数作用域内定义，确保后续可以使用）
    let Actor, ActorFromNfo, Movie, Genre, Studio, Director, MovieActor, MovieActorFromNfo, MovieGenre;
    
    try {
      Actor = require('../models/Actor')(sequelize);
      console.log('Actor模型已导入');
      ActorFromNfo = require('../models/ActorFromNfo')(sequelize);
      console.log('ActorFromNfo模型已导入');
      Movie = require('../models/Movie')(sequelize);
      console.log('Movie模型已导入');
      Genre = require('../models/Genre')(sequelize);
      console.log('Genre模型已导入');
      Studio = require('../models/Studio')(sequelize);
      console.log('Studio模型已导入');
      Director = require('../models/Director')(sequelize);
      console.log('Director模型已导入');
      MovieActor = require('../models/MovieActor')(sequelize);
      console.log('MovieActor模型已导入');
      MovieActorFromNfo = require('../models/MovieActorFromNfo')(sequelize);
      console.log('MovieActorFromNfo模型已导入');
      MovieGenre = require('../models/MovieGenre')(sequelize);
      console.log('MovieGenre模型已导入');
    } catch (modelError) {
      console.error('模型导入失败:', modelError);
      console.error('错误详情:', modelError.message);
      console.error('错误堆栈:', modelError.stack);
      throw modelError;
    }
    
    // sequelize.define() 会自动将模型添加到 sequelize.models 中
    // 但为了确保兼容性，我们显式地保存引用
    console.log('模型定义后的 sequelize.models:', Object.keys(sequelize.models || {}));
    
    // 显式注册模型（确保模型可用）
    sequelize.models.Actor = Actor;
    sequelize.models.ActorFromNfo = ActorFromNfo;
    sequelize.models.Movie = Movie;
    sequelize.models.Genre = Genre;
    sequelize.models.Studio = Studio;
    sequelize.models.Director = Director;
    sequelize.models.MovieActor = MovieActor;
    sequelize.models.MovieActorFromNfo = MovieActorFromNfo;
    sequelize.models.MovieGenre = MovieGenre;
    
    // 验证模型是否正确注册
    console.log('显式注册后的模型:', Object.keys(sequelize.models));
    console.log('Movie模型类型:', typeof sequelize.models.Movie);
    console.log('Movie模型是否有findAndCountAll:', typeof sequelize.models.Movie?.findAndCountAll);
    
    // 定义关联关系
    console.log('开始定义关联关系...');
    try {
      // 文件夹结构的演员关联
      Movie.belongsToMany(Actor, { through: MovieActor, foreignKey: 'movie_id' });
      Actor.belongsToMany(Movie, { through: MovieActor, foreignKey: 'actor_id' });
      
      // NFO文件中的演员关联（使用别名确保生成正确的方法名）
      Movie.belongsToMany(ActorFromNfo, { 
        through: MovieActorFromNfo, 
        foreignKey: 'movie_id',
        otherKey: 'actor_from_nfo_id',
        as: 'ActorsFromNfo'
      });
      ActorFromNfo.belongsToMany(Movie, { 
        through: MovieActorFromNfo, 
        foreignKey: 'actor_from_nfo_id',
        otherKey: 'movie_id',
        as: 'Movies'
      });
      
      Movie.belongsToMany(Genre, { through: MovieGenre, foreignKey: 'movie_id' });
      Genre.belongsToMany(Movie, { through: MovieGenre, foreignKey: 'genre_id' });
      
      Movie.belongsTo(Studio, { foreignKey: 'studio_id', allowNull: true });
      Studio.hasMany(Movie, { foreignKey: 'studio_id' });
      
      Movie.belongsTo(Director, { foreignKey: 'director_id', allowNull: true });
      Director.hasMany(Movie, { foreignKey: 'director_id' });
      console.log('关联关系定义完成');
    } catch (assocError) {
      console.error('关联关系定义失败:', assocError);
      throw assocError;
    }
    
    // 先禁用外键约束
    try {
      await sequelize.query('PRAGMA foreign_keys = OFF');
      console.log('外键约束已禁用');
    } catch (pragmaError) {
      console.error('禁用外键约束失败:', pragmaError);
      // 继续执行，因为可能数据库不支持
    }
    
    try {
      console.log('开始同步数据库表结构...');
      // 检查数据库文件是否存在
      const dbExists = fs.existsSync(dbPath);
      console.log('数据库文件是否存在:', dbExists);
      
      if (dbExists) {
        // 如果数据库已存在，先检查是否有新表需要创建
        try {
          // 检查关键表是否存在
          const [results] = await sequelize.query(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name IN ('movies', 'actors', 'actors_from_nfo', 'movie_actors_from_nfo', 'genres', 'studios', 'directors', 'movie_genres', 'movie_actors')
          `);
          const existingTables = results.map(r => r.name);
          console.log('已存在的表:', existingTables);
          
          // 检查是否有新表需要创建
          const requiredTables = ['movies', 'actors', 'actors_from_nfo', 'movie_actors_from_nfo', 'genres', 'studios', 'directors', 'movie_genres', 'movie_actors'];
          const missingTables = requiredTables.filter(t => !existingTables.includes(t));
          
          // 检查 movies 表是否有 director_id 列和 data_path_index 列
          let needsMigration = false;
          let needsDataPathIndex = false;
          if (existingTables.includes('movies')) {
            try {
              const [columns] = await sequelize.query(`PRAGMA table_info(movies)`);
              const hasDirectorId = columns.some(col => col.name === 'director_id');
              const hasDirector = columns.some(col => col.name === 'director');
              const hasDataPathIndex = columns.some(col => col.name === 'data_path_index');
              if (!hasDirectorId && hasDirector) {
                needsMigration = true;
                console.log('检测到需要迁移：movies 表有 director 字段但没有 director_id 字段');
              }
              if (!hasDataPathIndex) {
                needsDataPathIndex = true;
                console.log('检测到需要添加 data_path_index 字段');
              }
            } catch (err) {
              console.warn('检查表结构时出错:', err.message);
            }
          }
          
          if (missingTables.length > 0 || needsMigration || needsDataPathIndex) {
            if (missingTables.length > 0) {
              console.log('发现缺失的表，将创建:', missingTables);
            }
            if (needsMigration) {
              console.log('需要迁移表结构：将 director 字段迁移到 director_id');
            }
            
            // 如果需要迁移，先执行迁移
            if (needsMigration && existingTables.includes('movies')) {
              try {
                console.log('开始迁移 director 字段...');
                // 1. 创建 directors 表（如果不存在）
                if (!existingTables.includes('directors')) {
                  await sequelize.sync({ alter: false, force: false });
                }
                
                // 2. 迁移数据：将 director 字段的值迁移到 directors 表，并更新 movies.director_id
                const [movies] = await sequelize.query(`
                  SELECT id, director FROM movies WHERE director IS NOT NULL AND director != ''
                `);
                
                if (movies.length > 0) {
                  console.log(`找到 ${movies.length} 条需要迁移的影片记录`);
                  const Director = sequelize.models.Director;
                  
                  for (const movie of movies) {
                    if (movie.director) {
                      // 查找或创建导演
                      const [director] = await Director.findOrCreate({
                        where: { name: movie.director },
                        defaults: { name: movie.director }
                      });
                      
                      // 更新影片的 director_id
                      await sequelize.query(`
                        UPDATE movies SET director_id = ? WHERE id = ?
                      `, {
                        replacements: [director.id, movie.id]
                      });
                    }
                  }
                  console.log('导演数据迁移完成');
                }
                
                // 3. 使用 alter 更新表结构（添加 director_id，删除 director）
                console.log('更新表结构...');
                await sequelize.sync({ alter: true, force: false });
                console.log('表结构迁移完成');
              } catch (migrationError) {
                console.error('迁移失败:', migrationError);
                // 如果迁移失败，仍然尝试同步表结构
                await sequelize.sync({ alter: true, force: false });
              }
            } else {
              // 如果有缺失的表，使用 sync 创建（alter 不会创建新表）
              // 使用 sync 不带 alter 参数，这会创建缺失的表，但不会删除现有数据
              await sequelize.sync({ alter: false, force: false });
              console.log('数据库表同步成功（已创建缺失的表）');
            }
          } else {
            // 所有表都存在且结构正确，检查是否需要 alter（仅在必要时）
            // 在开发环境中也进行 alter，确保表结构是最新的
            console.log('检查数据库表结构是否需要更新...');
            await sequelize.sync({ alter: true, force: false });
            console.log('数据库表同步成功（保留现有数据）');
          }
          
          // 如果需要添加 data_path_index 字段
          if (needsDataPathIndex && existingTables.includes('movies')) {
            try {
              console.log('开始添加 data_path_index 字段...');
              // 检查字段是否已存在（可能在sync过程中已添加）
              const [columns] = await sequelize.query(`PRAGMA table_info(movies)`);
              const hasDataPathIndex = columns.some(col => col.name === 'data_path_index');
              if (!hasDataPathIndex) {
                // 添加 data_path_index 字段，默认值为0
                await sequelize.query(`
                  ALTER TABLE movies ADD COLUMN data_path_index INTEGER NOT NULL DEFAULT 0
                `);
                console.log('data_path_index 字段已添加');
              } else {
                console.log('data_path_index 字段已存在');
              }
            } catch (addColumnError) {
              console.error('添加 data_path_index 字段失败:', addColumnError);
              // 如果添加失败，尝试使用 sync alter
              try {
                await sequelize.sync({ alter: true, force: false });
                console.log('通过 sync alter 添加 data_path_index 字段');
              } catch (syncError) {
                console.error('通过 sync alter 添加字段也失败:', syncError);
              }
            }
          }
        } catch (alterError) {
          // alter失败时，尝试强制同步（但会丢失数据，所以先警告）
          console.error('数据库表结构更新失败:', alterError.message);
          console.warn('尝试创建缺失的表...');
          try {
            // 只同步缺失的模型，不删除现有数据
            await sequelize.sync({ alter: true, force: false });
            console.log('数据库表同步成功');
          } catch (syncError) {
            console.error('数据库同步最终失败:', syncError.message);
            console.warn('如果遇到问题，请手动删除数据库文件后重新启动');
            // 不抛出错误，继续使用现有数据库
          }
        }
      } else {
        // 如果数据库不存在，创建新数据库
        console.log('数据库文件不存在，创建新数据库...');
        await sequelize.sync({ force: false });
        console.log('新数据库创建成功');
      }
    } catch (syncError) {
      // 同步失败时，不强制重建，避免丢失数据
      console.error('数据库同步失败:', syncError.message);
      console.error('同步错误详情:', syncError);
      // 如果数据库文件存在，继续使用现有数据库
      if (fs.existsSync(dbPath)) {
        console.warn('数据库文件存在，继续使用现有数据库（可能表结构未更新）');
        // 不抛出错误，允许应用继续运行
      } else {
        // 如果数据库文件不存在且同步失败，抛出错误
        throw new Error('无法创建数据库: ' + syncError.message);
      }
    } finally {
      // 同步完成后启用外键约束
      try {
        await sequelize.query('PRAGMA foreign_keys = ON');
        console.log('外键约束已启用');
      } catch (pragmaError) {
        console.warn('启用外键约束失败:', pragmaError.message);
      }
    }
    
    console.log('数据库初始化完成');
    
    return sequelize;
  } catch (error) {
    console.error('数据库初始化失败:', error);
    console.error('错误类型:', error.constructor.name);
    console.error('错误消息:', error.message);
    if (error.stack) {
      console.error('错误堆栈:', error.stack);
    }
    throw error;
  }
}

// 获取sequelize实例
function getSequelize() {
  return sequelize;
}

module.exports = {
  initDatabase,
  getSequelize
};
