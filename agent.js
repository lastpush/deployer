const fs = require("fs");
const path = require("path");
const https = require("https");
const { exec } = require("child_process");

require("dotenv").config();

const ROOT_DIR = process.cwd();
const TASK_ZIP = path.join(ROOT_DIR, "task", "main.zip");
const SOURCE_DIR = path.join(ROOT_DIR, "source");
const RELEASE_DIR = path.join(ROOT_DIR, "release");
const MAX_STEPS = Number.parseInt(process.env.MAX_STEPS || "30", 10);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = process.env.OPENAI_API_URL;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_EMBEDDINGS_MODEL = process.env.OPENAI_EMBEDDINGS_MODEL;

if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY.");
  process.exit(1);
}

if (!OPENAI_API_URL) {
  console.error("Missing OPENAI_API_URL.");
  process.exit(1);
}

if (!OPENAI_EMBEDDINGS_MODEL) {
  console.error("Missing OPENAI_EMBEDDINGS_MODEL.");
  process.exit(1);
}

function execCommand(command, cwd) {
  return new Promise((resolve) => {
    exec(command, { cwd, shell: "/bin/bash", maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error && typeof error.code === "number" ? error.code : 0;
      resolve({ code, stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function pathExists(targetPath) {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function removeDir(targetPath) {
  if (!(await pathExists(targetPath))) {
    return;
  }
  if (fs.promises.rm) {
    await fs.promises.rm(targetPath, { recursive: true, force: true });
    return;
  }
  await execCommand(`rm -rf "${targetPath}"`, ROOT_DIR);
}

async function unzipTask() {
  await ensureDir(SOURCE_DIR);
  const result = await execCommand(`unzip -o "${TASK_ZIP}" -d "${SOURCE_DIR}"`, ROOT_DIR);
  if (result.code !== 0) {
    throw new Error(`unzip failed: ${result.stderr || result.stdout}`);
  }
}

async function listDirInfo(targetDir, depth = 1) {
  let lines = [];
  const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
  lines.push(`${path.basename(targetDir)}/: ${entries.length} items`);
  for (const entry of entries) {
    if (entry.isDirectory()) {
      lines.push(`- ${entry.name}/`);
      if (depth > 0) {
        const childDir = path.join(targetDir, entry.name);
        const childEntries = await fs.promises.readdir(childDir, { withFileTypes: true });
        const childList = childEntries.map((child) => (child.isDirectory() ? `${child.name}/` : child.name));
        lines.push(`  ${childList.join(", ") || "(empty)"}`);
      }
    } else {
      lines.push(`- ${entry.name}`);
    }
  }
  return lines.join("\n");
}

async function findPackageJsons(targetDir) {
  const results = [];
  const rootPkg = path.join(targetDir, "package.json");
  if (await pathExists(rootPkg)) {
    results.push(rootPkg);
  } else {
    const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const childPkg = path.join(targetDir, entry.name, "package.json");
      if (await pathExists(childPkg)) {
        results.push(childPkg);
      }
    }
  }
  return results;
}

async function readPackageJsonInfo(targetDir) {
  const packageJsons = await findPackageJsons(targetDir);
  if (packageJsons.length === 0) {
    return "未发现 package.json";
  }
  const blocks = [];
  for (const pkgPath of packageJsons) {
    const content = await fs.promises.readFile(pkgPath, "utf8");
    blocks.push(`${path.relative(ROOT_DIR, pkgPath)}:\n${content.trim()}`);
  }
  return blocks.join("\n\n");
}

function sanitizeCommand(text) {
  if (!text) {
    return "";
  }
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  return cleaned;
}

function summarizeOutput(result) {
  const combined = [
    `exit_code: ${result.code}`,
    result.stdout ? `stdout:\n${result.stdout}` : "stdout:\n(none)",
    result.stderr ? `stderr:\n${result.stderr}` : "stderr:\n(none)"
  ].join("\n");
  const limit = 6000;
  if (combined.length <= limit) {
    return combined;
  }
  return `${combined.slice(0, limit)}\n...(truncated)`;
}

function resolveChatCompletionsUrl(rawUrl) {
  const trimmed = rawUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/chat/completions`;
  }
  return `${trimmed}/v1/chat/completions`;
}

function callOpenAI(messages) {
  const body = JSON.stringify({
    model: OPENAI_MODEL,
    messages,
    temperature: 0.2
  });
  const url = new URL(resolveChatCompletionsUrl(OPENAI_API_URL));
  const options = {
    method: "POST",
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname + url.search,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Length": Buffer.byteLength(body)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 300) {
          reject(new Error(`OpenAI API error ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.message?.content;
          if (!content) {
            reject(new Error(`Unexpected OpenAI response: ${data}`));
            return;
          }
          resolve(content.trim());
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function findStaticOutputDir(rootDir) {
  const candidates = [];
  const excludeNames = new Set(["node_modules", ".git", ".next", "source", "release"]);

  async function walk(currentDir, depth) {
    if (depth < 0) {
      return;
    }
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (excludeNames.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      const indexPath = path.join(fullPath, "index.html");
      if (await pathExists(indexPath)) {
        const stats = await fs.promises.stat(fullPath);
        candidates.push({ dir: fullPath, mtimeMs: stats.mtimeMs });
      }
      await walk(fullPath, depth - 1);
    }
  }

  await walk(rootDir, 3);

  if (candidates.length === 0) {
    const fallbackDirs = ["dist", "build", "out", "public"];
    for (const name of fallbackDirs) {
      const candidate = path.join(rootDir, name);
      if (await pathExists(candidate)) {
        const stats = await fs.promises.stat(candidate);
        candidates.push({ dir: candidate, mtimeMs: stats.mtimeMs });
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0].dir;
}

async function moveToRelease(outputDir) {
  await ensureDir(RELEASE_DIR);
  const destDir = path.join(RELEASE_DIR, path.basename(outputDir));
  await removeDir(destDir);
  await fs.promises.rename(outputDir, destDir);
  return destDir;
}

async function main() {
  if (!(await pathExists(TASK_ZIP))) {
    throw new Error(`Zip not found: ${TASK_ZIP}`);
  }

  console.log("Step 1: Unzipping task/main.zip...");
  await unzipTask();

  console.log("Step 2: Collecting project info...");
  const dirInfo = await listDirInfo(SOURCE_DIR, 1);
  const pkgInfo = await readPackageJsonInfo(SOURCE_DIR);

  const systemMessage = {
    role: "system",
    content: "You are a terminal build agent. Reply with a single bash command only, or the exact phrase 操作完成."
  };
  const initialPrompt = [
    "现在你需要将该项目编译成可静态部署的前端，请你输出下一步我需要执行的指令，而我会返回给你指令操作的返回值。当你确定打包结束后，输出：操作完成",
    "",
    "环境: Ubuntu 20.04",
    `当前工作目录: ${SOURCE_DIR}`,
    "目录概览:",
    dirInfo,
    "",
    "package.json:",
    pkgInfo,
    "",
    "约束:",
    "- 仅输出下一步要执行的 bash 指令，不要添加解释或代码块",
    "- 如需切换目录，请包含在指令中",
    "- 当你确定打包结束后，仅输出：操作完成"
  ].join("\n");

  const messages = [systemMessage, { role: "user", content: initialPrompt }];

  console.log("Step 3: Starting GPT-driven build loop...");
  let completed = false;
  for (let step = 1; step <= MAX_STEPS; step += 1) {
    const reply = await callOpenAI(messages);
    const command = sanitizeCommand(reply);
    if (!command) {
      throw new Error("Received empty command from GPT.");
    }
    console.log(`\n[Step ${step}] GPT command: ${command}`);
    if (command === "操作完成") {
      completed = true;
      break;
    }
    const result = await execCommand(command, SOURCE_DIR);
    const output = summarizeOutput(result);
    messages.push({ role: "assistant", content: command });
    messages.push({ role: "user", content: output });
  }

  if (!completed) {
    throw new Error(`Reached MAX_STEPS=${MAX_STEPS} without completion.`);
  }

  console.log("Step 4: Moving build output to release/...");
  const outputDir = await findStaticOutputDir(SOURCE_DIR);
  if (!outputDir) {
    throw new Error("Unable to locate build output directory.");
  }
  const destDir = await moveToRelease(outputDir);
  console.log(`Release ready at: ${destDir}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
