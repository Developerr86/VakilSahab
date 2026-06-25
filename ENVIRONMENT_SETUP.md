# Environment Setup Guide

## Overview

This project requires several environment variables to be set for proper operation. The `.env.local` file contains placeholder values that need to be replaced with actual values.

## Environment Variables Required

### Supabase Configuration
- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key

### NVIDIA NIM Configuration
- `NVIDIA_NIM_API_KEY` - Your NVIDIA NIM API key
- `NVIDIA_NIM_BASE_URL` - NVIDIA NIM base URL (e.g., https://integrate.api.nvidia.com/v1)
- `NVIDIA_NIM_MODEL` - Model name (e.g., nvidia/llama-3.1-405b-instruct)

### OpenAI Configuration
- `OPENAI_API_KEY` - Your OpenAI API key (for embeddings only)

### App Configuration
- `NEXT_PUBLIC_APP_URL` - Your app URL (e.g., https://vakilsahab.vercel.app)

## How to Set Environment Variables

### Option 1: Using the Python Script

Run the `fill_env.py` script to update the Supabase API keys:

```bash
cd vakilsahab
python fill_env.py
```

The script will prompt you for the Supabase API keys and update the `.env.local` file.

### Option 2: Manual Update

Edit the `.env.local` file directly:

```bash
# Navigate to the project directory
cd vakilsahab

# Edit the .env.local file
nano .env.local
```

Replace the placeholder values with your actual values.

### Option 3: Using Vercel Dashboard

If you're deploying to Vercel, you can set environment variables in the Vercel dashboard:

1. Go to your Vercel project
2. Navigate to "Settings" → "Environment Variables"
3. Add the required environment variables
4. Deploy your changes

## Important Notes

### Supabase MCP Limitations

The **Supabase MCP tools** available in this environment are for:
- Running migrations
- Inspecting schemas
- Verifying ETL row counts

These tools **cannot** be used to set environment variables. To set environment variables, you need to use:
- The Vercel MCP (if available)
- The Vercel dashboard
- Manual editing of the `.env.local` file

### Search Agent Integration

The `search_web` tool now uses a **free, keyless, zero-infrastructure** search agent with the following providers:
- DuckDuckGo (web search)
- Wikipedia (facts and definitions)
- GitHub (open-source tools)
- Stack Exchange (technical solutions)

This agent provides deep, iterative research capabilities without requiring any API keys or paid services.

## Environment Variable Security

- **Never commit** the `.env.local` file to version control
- **Add** `.env.local` to your `.gitignore` file
- **Use environment variable managers** like dotenv or vault for production deployments

## Testing

After setting the environment variables, you can test the application:

```bash
# Start the development server
cd vakilsahab
npm run dev
```

The application should start successfully with the proper environment variables.

## Troubleshooting

### Common Issues

1. **Missing environment variables**: Ensure all required environment variables are set
2. **Invalid API keys**: Verify that your API keys are correct and have the necessary permissions
3. **Network connectivity**: Ensure your environment has internet access for API calls
4. **Configuration errors**: Check for any typos or formatting issues in the `.env.local` file

### Debugging

To debug environment variable issues:

1. Check the `.env.local` file for correct values
2. Verify that the environment variables are being read correctly
3. Check for any error messages in the application logs
4. Use the `fill_env.py` script to ensure the file is properly formatted

## Example .env.local File

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# NVIDIA NIM (LLM inference)
NVIDIA_NIM_API_KEY=nvapi-...
NVIDIA_NIM_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_NIM_MODEL=nvidia/llama-3.1-405b-instruct

# OpenAI (embeddings only — text-embedding-3-small)
OPENAI_API_KEY=sk-...

# App
NEXT_PUBLIC_APP_URL=https://vakilsahab.vercel.app
```

## Conclusion

Setting up the environment variables is a crucial step in getting the VakilSahab application running. Use one of the methods described above to set the required environment variables, and the application should work correctly.

Remember to keep your API keys secure and never share them publicly.
