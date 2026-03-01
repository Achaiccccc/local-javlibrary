<template>
  <div class="about">
    <el-container>
      <el-header>
        <h1 style="margin: 0;">关于</h1>
      </el-header>
      <el-main>
        <el-card class="about-card">
          <div class="about-content">
            <div class="app-logo">
              <el-icon :size="80" color="#409eff">
                <VideoCamera />
              </el-icon>
            </div>
            <h2 class="app-name">JavLibrary</h2>
            <div class="version">v2.5.1</div>
            
            <el-divider />
            
            <div class="info-section">
              <div class="info-item">
                <span class="info-label">开发者：</span>
                <span class="info-value">by Achaiccccc</span>
              </div>
              
              <div class="info-item">
                <span class="info-label">GitHub：</span>
                <span class="info-value info-placeholder">https://github.com/Achaiccccc/local-jav-lib</span>
              </div>
              <p class="star-hint">如果觉得这个项目对你有帮助，欢迎点个 Star 支持一下。</p>
              <p class="star-hint">你的支持是作者更新维护最大的动力。</p>

              <div class="info-item">
                <span class="info-label">联系方式：</span>
                <el-link 
                  :href="`mailto:${contactEmail}`" 
                  type="primary"
                  class="info-value"
                >
                  {{ contactEmail }}
                </el-link>
              </div>
            </div>
            
            <el-divider />
            <div class="description">
              <p>本软件仅供学习和技术交流使用，请遵守当地法律法规。</p>
            </div>
          </div>
        </el-card>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { VideoCamera } from '@element-plus/icons-vue';

const contactEmail = ref('x248336024@vip.qq.com');
</script>

<style scoped>
.about {
  width: 100%;
  height: 100%;
}

.el-header {
  background-color: #409eff;
  color: white;
  display: flex;
  align-items: center;
  padding: 0 20px;
}

.about-card {
  max-width: 600px;
  margin: 0 auto;
}

.about-content {
  text-align: center;
  padding: 20px;
}

.app-logo {
  margin-bottom: 20px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.app-name {
  font-size: 32px;
  font-weight: bold;
  color: #303133;
  margin-bottom: 10px;
}

.version {
  font-size: 18px;
  color: #909399;
  margin-bottom: 20px;
}

.info-section {
  text-align: left;
  margin: 20px 0;
}

.info-item {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
  padding: 12px;
  background-color: #f5f7fa;
  border-radius: 4px;
}

.info-label {
  font-weight: bold;
  color: #606266;
  min-width: 100px;
  margin-right: 12px;
}

.info-value {
  color: #303133;
  /* flex: 1; */
}

.info-placeholder {
  color: #909399;
  font-style: italic;
}

.star-hint {
  margin: 0 0 8px;
  padding: 0 12px;
  color: #606266;
  font-size: 14px;
  line-height: 1.6;
}

.description {
  margin-top: 20px;
  padding: 16px;
  background-color: #f0f9ff;
  border-radius: 4px;
  border-left: 4px solid #409eff;
}

.description p {
  margin: 0;
  color: #606266;
  line-height: 1.6;
  font-size: 14px;
}

:deep(.el-divider) {
  margin: 24px 0;
}
</style>
