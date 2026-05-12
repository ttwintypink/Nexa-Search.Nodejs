import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

if (!existsSync("./dist/index.js")) {
  console.log("[bootstrap] dist/index.js not found, building TypeScript project...");
  execSync("npm run build", { stdio: "inherit" });
}

await import("./dist/index.js");
