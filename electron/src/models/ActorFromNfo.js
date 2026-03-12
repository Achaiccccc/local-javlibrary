const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ActorFromNfo = sequelize.define('ActorFromNfo', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: true
    },
    display_name: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    former_names: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    // 软合并：若不为 null，则表示本记录已合并到 canonical 演员（id = merged_to_id）
    merged_to_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  }, {
    tableName: 'actors_from_nfo',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  return ActorFromNfo;
};
