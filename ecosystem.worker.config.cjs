module.exports = {
  apps: [
    {
      name: 'tiktok-seeding-worker',
      cwd: __dirname,
      script: 'pnpm',
      args: '--filter @app/worker run start',
      interpreter: 'none',
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
