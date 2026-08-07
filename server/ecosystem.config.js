/**
 * pm2 配置文件
 * 用法：
 *   pm2 start ecosystem.config.js      # 启动
 *   pm2 restart ecosystem.config.js    # 重启（部署脚本用）
 *   pm2 stop liuer-server              # 停止
 *   pm2 logs liuer-server              # 查看日志
 */
module.exports = {
  apps: [
    {
      name: 'liuer-server',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1,            // 对局状态在内存中，单实例保证一致性
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      // 自动重启 + 崩溃恢复
      autorestart: true,
      watch: false,
      ignore_watch: ['node_modules', 'logs'],
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      merge_logs: true,
    },
  ],
};
