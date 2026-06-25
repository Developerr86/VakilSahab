#!/usr/bin/env python3
"""
Script to help fill in Supabase API keys in the .env.local file.

This script will:
1. Read the current .env.local file
2. Prompt for the actual Supabase API keys
3. Update the .env.local file with the real values

Note: This script does NOT use the Supabase MCP. The Supabase MCP tools are
for database operations (migrations, schema inspection, ETL verification) and
cannot be used to set environment variables.

To set environment variables in Vercel, you would need to use the Vercel MCP
or manually set them in the Vercel dashboard.
"""

import os
from pathlib import Path

def main():
    env_path = Path("vakilsahab/.env.local")
    
    if not env_path.exists():
        print(f"Error: {env_path} does not exist")
        return
    
    # Read the current .env.local file
    content = env_path.read_text()
    lines = content.split('\n')
    
    print("Current .env.local file:")
    print(content)
    print("\n" + "="*50 + "\n")
    
    # Prompt for Supabase API keys
    print("Please provide the following Supabase API keys:")
    
    # Get NEXT_PUBLIC_SUPABASE_URL
    next_public_supabase_url = input("NEXT_PUBLIC_SUPABASE_URL: ").strip()
    if not next_public_supabase_url:
        print("Error: NEXT_PUBLIC_SUPABASE_URL is required")
        return
    
    # Get SUPABASE_SERVICE_ROLE_KEY
    supabase_service_role_key = input("SUPABASE_SERVICE_ROLE_KEY: ").strip()
    if not supabase_service_role_key:
        print("Error: SUPABASE_SERVICE_ROLE_KEY is required")
        return
    
    # Update the lines
    updated_lines = []
    for line in lines:
        if line.startswith("NEXT_PUBLIC_SUPABASE_URL="):
            updated_lines.append(f"NEXT_PUBLIC_SUPABASE_URL={next_public_supabase_url}")
        elif line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
            updated_lines.append(f"SUPABASE_SERVICE_ROLE_KEY={supabase_service_role_key}")
        else:
            updated_lines.append(line)
    
    # Write the updated content back to the file
    updated_content = '\n'.join(updated_lines)
    env_path.write_text(updated_content)
    
    print("\n✅ .env.local file has been updated with the new Supabase API keys!")
    print("\nUpdated .env.local file:")
    print(updated_content)
    
    print("\n" + "="*50 + "\n")
    print("Note: You still need to set the other environment variables:")
    print("- NVIDIA_NIM_API_KEY")
    print("- NVIDIA_NIM_BASE_URL")
    print("- NVIDIA_NIM_MODEL")
    print("- OPENAI_API_KEY")
    print("- NEXT_PUBLIC_APP_URL")
    print("\nThese can be set in Vercel dashboard or by updating the .env.local file manually.")

if __name__ == "__main__":
    main()