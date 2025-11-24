# Deployment Guide

This guide will walk you through deploying Mockup Magic Pro to GitHub and Vercel.

## Step 1: Create GitHub Repository

1. Go to [GitHub](https://github.com) and sign in
2. Click the "+" icon in the top right corner
3. Select "New repository"
4. Fill in the repository details:
   - **Repository name**: `mockup-magic-pro` (or your preferred name)
   - **Description**: "AI-powered mockup generator using Gemini AI"
   - **Visibility**: Choose Public or Private
   - **DO NOT** initialize with README, .gitignore, or license (we already have these)
5. Click "Create repository"

## Step 2: Push to GitHub

After creating the repository, GitHub will show you commands. Use these commands in your terminal:

```bash
cd /Users/abi/Sites/mockup-magic-pro

# Add the remote repository (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/mockup-magic-pro.git

# Rename branch to main if needed
git branch -M main

# Push to GitHub
git push -u origin main
```

**Alternative: Using SSH**
```bash
git remote add origin git@github.com:YOUR_USERNAME/mockup-magic-pro.git
git branch -M main
git push -u origin main
```

## Step 3: Deploy to Vercel

### Option A: Deploy via Vercel Dashboard (Recommended)

1. Go to [Vercel](https://vercel.com) and sign in (or create an account)
2. Click "Add New..." → "Project"
3. Import your GitHub repository:
   - Find `mockup-magic-pro` in the list
   - Click "Import"
4. Configure the project:
   - **Framework Preset**: Vite (should be auto-detected)
   - **Root Directory**: `./` (default)
   - **Build Command**: `npm run build` (default)
   - **Output Directory**: `dist` (default)
5. **Add Environment Variable**:
   - Click "Environment Variables"
   - Add a new variable:
     - **Name**: `GEMINI_API_KEY`
     - **Value**: Your Gemini API key (get it from [Google AI Studio](https://aistudio.google.com/app/apikey))
     - **Environment**: Production, Preview, and Development (select all)
6. Click "Deploy"

Vercel will automatically:
- Install dependencies
- Build your project
- Deploy it to a production URL

### Option B: Deploy via Vercel CLI

1. Install Vercel CLI:
   ```bash
   npm i -g vercel
   ```

2. Login to Vercel:
   ```bash
   vercel login
   ```

3. Deploy:
   ```bash
   cd /Users/abi/Sites/mockup-magic-pro
   vercel
   ```

4. Follow the prompts:
   - Link to existing project or create new
   - Add environment variable when prompted:
     - Name: `GEMINI_API_KEY`
     - Value: Your API key

5. For production deployment:
   ```bash
   vercel --prod
   ```

## Step 4: Verify Deployment

1. After deployment, Vercel will provide you with a URL like:
   - `https://mockup-magic-pro.vercel.app`
   - Or a custom domain if you've configured one

2. Visit the URL and test the application:
   - Upload an image
   - Generate a mockup
   - Verify everything works correctly

## Environment Variables

Make sure `GEMINI_API_KEY` is set in:
- ✅ Vercel Dashboard → Project Settings → Environment Variables
- ✅ Local `.env.local` file (for development)

## Continuous Deployment

Once connected to GitHub, Vercel will automatically:
- Deploy every push to `main` branch (production)
- Create preview deployments for pull requests
- Rebuild on every commit

## Troubleshooting

### Build Fails
- Check that all dependencies are in `package.json`
- Verify Node.js version (Vercel uses Node 18+ by default)
- Check build logs in Vercel dashboard

### API Key Not Working
- Verify the environment variable is set in Vercel
- Make sure it's available for all environments (Production, Preview, Development)
- Check that the variable name is exactly `GEMINI_API_KEY`

### 404 Errors on Routes
- Vercel should handle this automatically with the `vercel.json` configuration
- If issues persist, check the rewrite rules in `vercel.json`

## Next Steps

- Set up a custom domain in Vercel (optional)
- Configure analytics (optional)
- Set up preview deployments for branches (automatic)

## Support

If you encounter issues:
1. Check Vercel deployment logs
2. Verify environment variables are set correctly
3. Test locally with `npm run build` to catch build errors early

