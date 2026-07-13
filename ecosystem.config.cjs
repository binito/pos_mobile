module.exports = {
  apps: [
    {
      name: 'pos-mobile-orders',
      script: './server.js',
      cwd: '/home/jorge/pos_mobile',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      max_memory_restart: '150M',
      time: true,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
