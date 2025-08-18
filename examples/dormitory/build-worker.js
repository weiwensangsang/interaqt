#!/usr/bin/env node

import * as esbuild from "esbuild";
import { mkdirSync } from "fs";

// 确保输出目录存在
mkdirSync("./deploy/functions", { recursive: true });

// 需要 stub 的模块（只保留必要的）
const stubModules = [
  "@electric-sql/pglite",
  "better-sqlite3",
  "pg",
  "pg-pool",
  "mysql2",
  "pino",
];

await esbuild
  .build({
    entryPoints: ["./worker.ts"],
    bundle: true,
    outfile: "./deploy/functions/api.js",
    platform: "node",
    target: "es2022",
    format: "esm",
    minify: true,
    keepNames: false,
    sourcemap: false,
    define: {
      "process.env.NODE_ENV": '"production"',
      global: "globalThis",
      process: "{}",
      Buffer: "{}",
    },
    plugins: [
      {
        name: "stub-plugin",
        setup(build) {
          // 为不支持的模块创建 stub
          stubModules.forEach((mod) => {
            build.onResolve({ filter: new RegExp(`^${mod}`) }, () => ({
              path: mod,
              namespace: "stub",
            }));
          });

          // 提供最小化的 stub 实现
          build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => {
            // 为不同的模块提供相应的 stub
            let contents = `export default {}`;
            
            if (args.path === "@electric-sql/pglite") {
              contents = `
                export class PGlite {
                  async query() { return { rows: [] }; }
                  async exec() { return {}; }
                  async close() {}
                }
                export default PGlite;
              `;
            } else if (args.path === "pg") {
              contents = `
                export class Client {}
                export class Pool {}
                export default { Client, Pool };
              `;
            } else if (args.path === "pino") {
              contents = `
                const logger = {
                  trace: console.trace,
                  debug: console.debug,
                  info: console.info,
                  warn: console.warn,
                  error: console.error,
                  fatal: console.error,
                  child: () => logger,
                  level: 'info'
                };
                const pino = () => logger;
                pino.default = pino;
                export default pino;
                export { pino };
              `;
            }
            
            return { contents, loader: "js" };
          });
        },
      },
    ],
  })
  .then(() => console.log("✅ Build complete: ./deploy/functions/api.js"))
  .catch((err) => {
    console.error("❌ Build failed:", err);
    process.exit(1);
  });
