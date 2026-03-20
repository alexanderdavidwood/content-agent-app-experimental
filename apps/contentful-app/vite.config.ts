import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function resolveHttpsConfig(env: Record<string, string>) {
  const keyPath = env.VITE_DEV_SSL_KEY_PATH?.trim();
  const certPath = env.VITE_DEV_SSL_CERT_PATH?.trim();

  if (!keyPath || !certPath) {
    return undefined;
  }

  const resolvedKeyPath = resolve(keyPath);
  const resolvedCertPath = resolve(certPath);

  if (!existsSync(resolvedKeyPath) || !existsSync(resolvedCertPath)) {
    throw new Error(
      `Vite HTTPS cert files were not found. Checked ${resolvedKeyPath} and ${resolvedCertPath}.`,
    );
  }

  return {
    key: readFileSync(resolvedKeyPath),
    cert: readFileSync(resolvedCertPath),
  };
}

export default defineConfig(({ mode }) => {
  const configDir = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = resolve(configDir, "../..");
  const env = {
    ...loadEnv(mode, repoRoot, ""),
    ...loadEnv(mode, process.cwd(), ""),
  };
  const https = resolveHttpsConfig(env);
  const port = Number(env.VITE_PORT || 3000);

  return {
    plugins: [react()],
    server: {
      host: "localhost",
      port,
      strictPort: true,
      https,
    },
    preview: {
      host: "localhost",
      port,
      strictPort: true,
      https,
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
  };
});
