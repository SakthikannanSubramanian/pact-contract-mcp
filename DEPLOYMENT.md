# Cloud Deployment Guide

## Option 1: Railway (Easiest - Recommended)

Railway offers $5 free credit per month and is the simplest deployment option.

### Steps:

1. **Push your code to GitHub** (if not already):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```

2. **Deploy to Railway**:
   - Go to [railway.app](https://railway.app)
   - Click **"Start a New Project"**
   - Select **"Deploy from GitHub repo"**
   - Choose your `contract-testing-mcp` repository
   - Railway auto-detects the Dockerfile and deploys

3. **Get your public URL**:
   - Go to your project **Settings** → **Networking**
   - Click **"Generate Domain"**
   - You'll get a URL like: `https://your-app.railway.app`

4. **Share with your team**:
   ```json
   {
     "pact-contract-mcp": {
       "type": "http",
       "url": "https://your-app.railway.app/mcp"
     }
   }
   ```

5. **Verify deployment**:
   ```bash
   curl https://your-app.railway.app/health
   ```

---

## Option 2: Render (Free Tier Available)

Free tier available with 750 hours/month.

### Steps:

1. **Push to GitHub** (same as Railway)

2. **Deploy to Render**:
   - Go to [render.com](https://render.com)
   - Click **"New +"** → **"Web Service"**
   - Connect your GitHub repository
   - Configure:
     - **Name**: `pact-contract-mcp`
     - **Environment**: `Docker`
     - **Plan**: Free (or paid for better performance)

3. **Render auto-detects** your Dockerfile and deploys

4. **Get your URL**: `https://pact-contract-mcp.onrender.com`

---

## Option 3: Fly.io (Developer-Friendly)

Free tier: 3 shared VMs with 256MB RAM each.

### Steps:

1. **Install Fly CLI**:
   ```bash
   brew install flyctl
   ```

2. **Login**:
   ```bash
   fly auth login
   ```

3. **Initialize and deploy**:
   ```bash
   cd pact-contract-mcp
   fly launch --name pact-contract-mcp --no-deploy
   
   # Edit fly.toml if needed, then:
   fly deploy
   ```

4. **Get your URL**: `https://pact-contract-mcp.fly.dev`

---

## Option 4: Google Cloud Run (Serverless)

Generous free tier: 2 million requests/month.

### Steps:

1. **Install gcloud CLI**:
   ```bash
   brew install google-cloud-sdk
   ```

2. **Authenticate and set project**:
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```

3. **Build and deploy**:
   ```bash
   cd pact-contract-mcp
   gcloud run deploy pact-contract-mcp \
     --source . \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated
   ```

4. **Get your URL**: Shown in the deployment output

---

## Cost Comparison

| Platform | Free Tier | Best For |
|----------|-----------|----------|
| **Railway** | $5/month credit | Easiest setup |
| **Render** | 750 hrs/month | Simple + free |
| **Fly.io** | 3 VMs (256MB) | Developer-friendly |
| **Cloud Run** | 2M requests/month | Serverless, auto-scale |

---

## After Deployment

### Team Configuration File

Share this `.vscode/mcp.json` with your team:

```json
{
  "mcpServers": {
    "pact-contract-mcp": {
      "type": "http",
      "url": "https://YOUR-DEPLOYMENT-URL/mcp"
    }
  }
}
```

### Health Check

Test the deployment:
```bash
curl https://YOUR-DEPLOYMENT-URL/health
```

Expected response:
```json
{
  "status": "ok",
  "transport": "streamable-http",
  "sessions": 0
}
```

---

## Troubleshooting

### Deployment fails
- Check logs in your platform's dashboard
- Ensure `Dockerfile` builds locally: `docker build -t test .`
- Verify `package.json` has all dependencies

### Health check fails
- The server listens on port from `PORT` environment variable
- Railway/Render/Cloud Run set this automatically
- Check platform logs for errors

### Connection timeout
- Ensure the service is running (check platform dashboard)
- Verify the URL includes `/mcp` endpoint
- Check the health endpoint first: `/health`

---

## Recommended: Railway

For corporate environments with firewall restrictions, **Railway is the easiest option**:
- No CLI required
- Auto-deploys on git push
- Built-in domain and SSL
- Simple web dashboard
- $5/month credit is enough for this use case

**Deploy time: ~5 minutes**
