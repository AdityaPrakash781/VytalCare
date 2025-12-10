{
  "framework": "vite",
  "outputDirectory": "dist",
  "buildCommand": "npm run build",

  "functions": {
    "api/*.js": {
      "runtime": "nodejs20.x",
      "memory": 1024,
      "maxDuration": 20
    }
  },

  "routes": [
    { "src": "/api/(.*)", "dest": "/api/$1" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
