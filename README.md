<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Mockup Magic Pro

Upload your designs and instantly generate professional product mockups using the power of Gemini AI. Create stunning visualizations of your artwork in various environments with customizable frames, lighting, and wall textures.

## Features

- 🎨 **AI-Powered Mockup Generation** - Transform your artwork into professional mockups
- 🖼️ **Multiple Frame Styles** - Choose from various frame options or go frameless
- 💡 **Customizable Lighting** - Control the lighting conditions of your mockups
- 🏠 **Wall Textures** - Select from different wall textures and materials
- 📐 **Multiple Print Sizes** - A1, A2, A3, A4 support
- 🎭 **Vibe-Based Analysis** - AI suggests environments based on your artwork's style
- ⚡ **Batch Generation** - Generate multiple variations at once
- 🚀 **High-Resolution Output** - Generate 1K drafts and upscale to 4K

## Tech Stack

- **React 19** - Modern React with latest features
- **TypeScript** - Type-safe development
- **Vite** - Fast build tool and dev server
- **Google Gemini AI** - AI-powered image generation
- **Tailwind CSS** - Utility-first CSS framework
- **Heroicons** - Beautiful icon library

## Prerequisites

- Node.js 18+ 
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

## Local Development

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd mockup-magic-pro
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env.local` file in the root directory:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

4. **Run the development server**
   ```bash
   npm run dev
   ```

   The app will be available at `http://localhost:3000`

## Building for Production

```bash
npm run build
```

The production build will be in the `dist` directory.

## Deployment

### Deploy to Vercel

1. **Push your code to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```

2. **Deploy to Vercel**
   - Go to [Vercel](https://vercel.com)
   - Click "New Project"
   - Import your GitHub repository
   - Add environment variable:
     - Name: `GEMINI_API_KEY`
     - Value: Your Gemini API key
   - Click "Deploy"

   Vercel will automatically detect the Vite configuration and deploy your app.

### Alternative: Manual Vercel Deployment

If you prefer using the Vercel CLI:

```bash
npm i -g vercel
vercel
```

Make sure to add the `GEMINI_API_KEY` environment variable in the Vercel dashboard.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GEMINI_API_KEY` | Your Google Gemini API key | Yes |

## Project Structure

```
mockup-magic-pro/
├── App.tsx              # Main application component
├── index.tsx            # Application entry point
├── index.html           # HTML template
├── types.ts             # TypeScript type definitions
├── vite.config.ts       # Vite configuration
├── services/
│   └── geminiService.ts # Gemini API service
└── package.json         # Dependencies and scripts
```

## Usage

1. **Upload Your Artwork**
   - Drag and drop or click to upload a JPEG image
   - The app will automatically analyze your image

2. **Choose Your Vibe**
   - Select an analysis vibe that matches your desired aesthetic
   - The AI will suggest environment prompts based on your selection

3. **Customize Constraints**
   - Select frame styles, lighting, and wall textures
   - Choose multiple options for variety in batch generation
   - Set the print size

4. **Edit Prompts**
   - Review and edit the AI-generated prompts
   - Add or remove prompts as needed
   - Regenerate individual prompts if desired

5. **Generate Mockups**
   - Click "Run Batch" to generate all variations
   - Wait for generation to complete
   - View results in the gallery

6. **Download & Upscale**
   - Download individual images or all at once
   - Upscale drafts to 4K resolution
   - Delete unwanted results

## License

This project is private and proprietary.

## Support

For issues and questions, please open an issue on GitHub.
