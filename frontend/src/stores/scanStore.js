/**
 * 扫描/数据变更标记：用于 keep-alive 缓存的列表页在激活时判断是否需要刷新
 * 用户触发扫描（完整/增量）或启动自动同步完成后递增，缓存页 onActivated 时若 dataVersion 大于本页已刷新版本则重新拉取数据
 */
import { defineStore } from 'pinia';

export const useScanStore = defineStore('scan', {
  state: () => ({ dataVersion: 0 }),
  actions: {
    incrementDataVersion() {
      this.dataVersion += 1;
    }
  }
});
