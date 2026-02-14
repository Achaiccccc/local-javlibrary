const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Movie = sequelize.define('Movie', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    title: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    code: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: true
    },
    runtime: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    premiered: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    director_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'directors',
        key: 'id'
      }
    },
    studio_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'studios',
        key: 'id'
      }
    },
    poster_path: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    fanart_path: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    nfo_path: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    folder_path: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    playable: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    video_path: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    data_path_index: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: '数据路径索引，用于多路径支持'
    },
    folder_updated_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '作品文件夹的修改时间（用于按更新时间排序）'
    }
  }, {
    tableName: 'movies',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['code'] },
      { fields: ['premiered'] },
      { fields: ['title'] },
      { fields: ['playable'] },
      { fields: ['data_path_index'] },
      { fields: ['folder_updated_at'] }
    ]
  });

  return Movie;
};
