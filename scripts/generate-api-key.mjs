#!/usr/bin/env node

import { createHash } from "crypto";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// .env.local または .env を読み込む
function loadEnvFile() {
  const envFiles = [".env.local", ".env"];

  for (const file of envFiles) {
    const filePath = resolve(process.cwd(), file);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const [key, ...valueParts] = trimmed.split("=");
          const value = valueParts.join("=");
          if (key && value && !process.env[key]) {
            process.env[key] = value;
          }
        }
      }
      break;
    }
  }
}

loadEnvFile();

const secret = process.env.SECRET;
const githubToken = process.env.GITHUB_TOKEN;

if (!secret) {
  console.error("Error: SECRET environment variable is required");
  process.exit(1);
}

if (!githubToken) {
  console.error("Error: GITHUB_TOKEN environment variable is required");
  process.exit(1);
}

const apiKey = createHash("sha256")
  .update(secret + githubToken)
  .digest("hex");

console.log("Generated API_KEY:");
console.log(apiKey);
