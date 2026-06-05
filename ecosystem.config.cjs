module.exports = {
  apps: [
    {
      name: 'agent-core',
      script: 'app.js',
      cwd: './agent-core',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'vector-svc',
      script: 'uvicorn',
      args: 'server:app --host 0.0.0.0 --port 8765',
      interpreter: './venv/Scripts/python.exe',
      cwd: './vector-service',
      wait_ready: true,
      listen_timeout: 15000,
      env: {
        PYTHONUNBUFFERED: '1',
      },
    },
  ],
};
