module.exports = {
  apps: [
    {
      name: 'tiktok-seeding-master',
      cwd: __dirname,
      script: 'apps/master/dist/index.js',
      interpreter: 'node',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      out_file: '.runtime/pm2-master.log',
      error_file: '.runtime/pm2-master.err.log',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'tiktok-seeding-worker',
      cwd: __dirname,
      script: 'apps/worker/dist/index.js',
      interpreter: 'node',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      out_file: '.runtime/pm2-worker.log',
      error_file: '.runtime/pm2-worker.err.log',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
