// PM2 process file for the game server on a VM (e.g. Oracle Cloud Always Free).
//   pm2 start deploy/pm2/ecosystem.config.cjs && pm2 save
// Exactly ONE instance in fork mode: focus sessions are tracked in-process, so cluster mode or
// several instances would break the one-session-per-user rule.
const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'focus-town',
      cwd: path.join(__dirname, '..', '..', 'server'),
      script: 'dist/index.js',
      // Secrets live in server/.env (not committed).
      node_args: '--env-file=.env',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: '2567',
      },
      // Give rooms time to pay out focus sessions on shutdown before PM2 kills the process.
      kill_timeout: 20000,
      max_memory_restart: '1G',
      restart_delay: 2000,
      time: true,
    },
  ],
};
