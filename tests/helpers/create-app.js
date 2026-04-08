const path = require('path');
const fs = require('fs');
const os = require('os');
const { createApp: realCreateApp } = require('../../api/server');

function createApp() {
  const dbPath = path.join(
    os.tmpdir(),
    `leo-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  const app = realCreateApp(dbPath);
  app.cleanup = () => {
    return new Promise((resolve) => {
      app._db.close(() => {
        try { fs.unlinkSync(dbPath); } catch {}
        resolve();
      });
    });
  };
  return app;
}

module.exports = { createApp };
