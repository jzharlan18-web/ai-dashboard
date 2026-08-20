/**
 * qna-to-ima.mjs — 从阅读笔记生成 Markdown Q&A 并写入 IMA 知识库
 *
 * 流程：
 *   1. 读取文档笔记（含 codex-explanation 条目）
 *   2. 调用 Codex CLI 生成带标题的 Q&A Markdown
 *   3. 用户确认后写入 IMA（media_type=7 Markdown）
 *      - 先搜索目标知识库 + 文件夹
 *      - check_repeated_names → create_media → COS 上传 → add_knowledge
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { spawn as spawnProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const workbenchRoot = fileURLToPath(new URL("..", import.meta.url));

import {
  DEFAULT_VAULT_ROOT,
  isPathInside,
} from "./security.mjs";
import { detectCodexCli } from "./codex-runner.mjs";

// ─── IMA 配置（持久化在 workspace 配置目录） ────────────────────────────────

const IMA_CONFIG_PATH = "config/qna-to-ima.json";

const DEFAULT_KB_ID =
  "G8VXyz49dgPw1JWBMk53_AasSDq8_zk0bUhEXxLkBks="; // AI 与教育知识库

const TARGET_FOLDER_NAME = "问答知识库";
const PARENT_FOLDER_NAME = "AI 研训";

// ─── Codex Q&A 生成 prompt ──────────────────────────────────────────────────

function buildQnAGeneratePrompt({ documentTitle, sourceContent, notes }) {
  const codexNotes = notes
    .filter((n) => n.type === "quote" && n.origin === "codex-explanation")
    .map((n, i) => {
      const q = n.question || `问题 ${i + 1}`;
      const a = n.body || n.answer || "（无回答）";
      return `---\n问题：${q}\n引用原文：${n.quoteText || "（无）"}\n解答：${a}\n---`;
    });

  const otherNotes = notes
    .filter((n) => !(n.type === "quote" && n.origin === "codex-explanation"))
    .map((n, i) => {
      const prefix = n.type === "free" ? "全文笔记" : "引用笔记";
      return `### ${prefix} ${i + 1}\n${n.body || n.quoteText || "（空）"}`;
    });

  return `你是一位内容整理助手。请根据以下文章内容和阅读笔记，生成一份结构清晰的 Markdown 格式问答集（Q&A），用于导入知识管理平台。

## 要求

1. 标题：生成一个概括全文主题的 # 级标题，格式：# 【主题分类】文章主题
   - 主题分类从以下中选最合适的一个：语文教育、AI与教育、作文教学、高考备考、教学方法、教育技术、课程理念
2. 问答条目：
   - 每个问答对应一个 ## 级标题，格式：## Qn：核心问题概述？
   - 问题要精炼、准确，能让读者从标题即了解内容要点
   - 解答要完整、有层次，可适当分点
   - 保留原文引用（用 > 引用块）
3. 不要添加总结段落或推荐语
4. 纯 Markdown 输出，不要解释性文字

## 文章标题

${documentTitle}

## 文章正文（节选/摘要）

${(sourceContent || "").slice(0, 8000)}

## 阅读笔记（含 AI 辅助解释）

${codexNotes.length ? codexNotes.join("\n\n") : "（无 Codex 问答笔记）"}

${otherNotes.length ? "\n## 其他笔记\n\n" + otherNotes.join("\n\n") : ""}

请输出完整的 Markdown Q&A。`;
}

// ─── 文件安全工具 ────────────────────────────────────────────────────────────

function safeFileName(title, suffix = "") {
  const base = (title || "untitled")
    .replace(/[\\/:*?"<>|]/g, "_")
    .slice(0, 60);
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 8);
  const s = suffix ? `-${suffix}` : "";
  return `${base}${s}-${ts}.md`;
}

// ─── IMA API 调用（直接用 fetch，凭证从 ~/.config/ima/ 或环境变量读取） ──────────────────────

const IMA_CREDENTIALS_PATH = join(
  process.env.HOME || "",
  ".config",
  "ima",
);

function loadImaCredentials() {
  // 优先使用已注入的环境变量。
  let clientId =
    process.env.IMA_CLIENT_ID ||
    process.env.IMA_OPENAPI_CLIENTID ||
    "";
  let apiKey =
    process.env.IMA_API_KEY ||
    process.env.IMA_OPENAPI_APIKEY ||
    "";

  // Vite 的 .env 默认只进入 Vite 配置，不保证进入 Node 服务进程；
  // 因此在服务端再读取项目根目录 .env，避免“文件已配置但进程看不到”。
  if (!clientId || !apiKey) {
    try {
      const envText = readFileSync(join(workbenchRoot, ".env"), "utf8");
      const values = Object.fromEntries(
        envText
          .split(/\\r?\\n/)
          .map((line) => line.match(/^\\s*([A-Z0-9_]+)\\s*=\\s*(.*?)\\s*$/))
          .filter(Boolean)
          .map(([, key, value]) => [key, value.replace(/^(["'])(.*)\\1$/, "$2")]),
      );
      clientId ||= values.IMA_CLIENT_ID || "";
      apiKey ||= values.IMA_API_KEY || "";
    } catch {}
  }

  if (clientId && apiKey) return { clientId, apiKey };

  // 最后回退到用户级配置文件。
  try {
    clientId = readFileSync(join(IMA_CREDENTIALS_PATH, "client_id"), "utf8").trim();
    apiKey = readFileSync(join(IMA_CREDENTIALS_PATH, "api_key"), "utf8").trim();
    if (clientId && apiKey) return { clientId, apiKey };
  } catch {}

  return null;
}

async function imaPost(apiPath, body, credentials) {
  const baseUrl = process.env.IMA_BASE_URL || "https://ima.qq.com";
  const res = await fetch(`${baseUrl}/${apiPath}`, {
    method: "POST",
    headers: {
      "ima-openapi-clientid": credentials.clientId,
      "ima-openapi-apikey": credentials.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { code: -1, msg: `IMA 响应非 JSON: ${text.slice(0, 200)}` };
  }
}

/**
 * 搜索知识库中的文件夹，按名称匹配
 */
async function searchFolder(credentials, kbId, query, cursor = "") {
  return imaPost("openapi/wiki/v1/search_knowledge", {
    query,
    knowledge_base_id: kbId,
    cursor,
  }, credentials);
}

/**
 * 获取知识库内容列表（用于逐级遍历）
 */
async function getKnowledgeList(credentials, kbId, folderId, cursor = "") {
  const body = {
    knowledge_base_id: kbId,
    cursor,
    limit: 50,
  };
  if (folderId) body.folder_id = folderId;
  return imaPost("openapi/wiki/v1/get_knowledge_list", body, credentials);
}

/**
 * 定位目标文件夹：KB → "AI 研训" → "问答知识库"
 */
async function locateTargetFolder(credentials, kbId) {
  // 1. 找 AI 研训 文件夹
  const parentResult = await searchFolder(credentials, kbId, PARENT_FOLDER_NAME);
  if (parentResult.code !== 0) {
    throw new Error(`搜索"${PARENT_FOLDER_NAME}"失败：${parentResult.msg}`);
  }
  const parentFolder = (parentResult.data?.info_list || []).find(
    (item) => item.title?.includes(PARENT_FOLDER_NAME) ||
              item.name?.includes(PARENT_FOLDER_NAME),
  );
  if (!parentFolder) {
    // 尝试用 get_knowledge_list 根目录搜索
    const rootList = await getKnowledgeList(credentials, kbId, null);
    const found = (rootList.data?.knowledge_list || []).find(
      (item) => item.title?.includes(PARENT_FOLDER_NAME) ||
                item.name?.includes(PARENT_FOLDER_NAME),
    );
    if (!found) {
      throw new Error(`未在知识库中找至"${PARENT_FOLDER_NAME}"文件夹`);
    }
    // 递归查找子文件夹
    return locateSubFolder(
      credentials,
      kbId,
      found.media_id || found.folder_id,
      TARGET_FOLDER_NAME,
    );
  }

  const parentId = parentFolder.media_id || parentFolder.folder_id;
  return locateSubFolder(credentials, kbId, parentId, TARGET_FOLDER_NAME);
}

async function locateSubFolder(credentials, kbId, parentFolderId, targetName) {
  // 分页浏览子文件夹
  let cursor = "";
  let depth = 0;
  while (depth < 10) {
    const result = await getKnowledgeList(credentials, kbId, parentFolderId, cursor);
    if (result.code !== 0) {
      throw new Error(`浏览文件夹失败：${result.msg}`);
    }
    const items = result.data?.knowledge_list || [];
    const match = items.find(
      (item) =>
        (item.title || item.name || "").includes(targetName) &&
        (item.media_type === 99 || !item.media_type), // 文件夹
    );
    if (match) {
      return match.media_id || match.folder_id;
    }
    if (result.data?.is_end) break;
    cursor = result.data?.next_cursor || "";
    depth++;
  }
  throw new Error(`未在"${parentFolderId}"下找到"${targetName}"文件夹`);
}

/**
 * 检查文件名是否重复
 */
async function checkRepeatedNames(credentials, kbId, folderId, fileName) {
  return imaPost("openapi/wiki/v1/check_repeated_names", {
    params: [{ name: fileName, media_type: 7 }],
    knowledge_base_id: kbId,
    ...(folderId ? { folder_id: folderId } : {}),
  }, credentials);
}

/**
 * 创建媒体（获取 COS 上传凭证）
 */
async function createMedia(credentials, kbId, fileName, fileSize, folderId) {
  return imaPost("openapi/wiki/v1/create_media", {
    file_name: fileName,
    file_size: fileSize,
    content_type: "text/markdown",
    knowledge_base_id: kbId,
    file_ext: "md",
    ...(folderId ? { folder_id: folderId } : {}),
  }, credentials);
}

/**
 * COS 上传（内联实现，避免调用外部脚本）
 */
async function uploadToCos(credentials, cosCredential, fileName, fileContent) {
  const {
    secret_id, secret_key, token, bucket_name, region, cos_key,
    start_time, expired_time,
  } = cosCredential;

  const hostname = `${bucket_name}.cos.${region}.myqcloud.com`;
  const pathname = `/${cos_key}`;
  const startTime = String(start_time);
  const expiredTime = String(expired_time);
  const keyTime = `${startTime};${expiredTime}`;

  // HMAC-SHA1 签名
  const crypto = await import("node:crypto");
  function hmacSha1(key, data) {
    return crypto.default.createHmac("sha1", key).update(data).digest("hex");
  }
  function sha1(data) {
    return crypto.default.createHash("sha1").update(data).digest("hex");
  }

  const signKey = hmacSha1(secret_key, keyTime);
  const httpHeaders = `host=${encodeURIComponent(hostname)}`;
  const httpString = `put\n${pathname}\n\n${httpHeaders}\n`;
  const stringToSign = `sha1\n${keyTime}\n${sha1(httpString)}\n`;
  const signature = hmacSha1(signKey, stringToSign);
  const auth = [
    `q-sign-algorithm=sha1`,
    `q-ak=${secret_id}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=host`,
    `q-url-param-list=`,
    `q-signature=${signature}`,
  ].join("&");

  const https = await import("node:https");
  const { URL } = await import("node:url");

  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      port: 443,
      path: pathname,
      method: "PUT",
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Length": Buffer.byteLength(fileContent),
        Authorization: auth,
        "x-cos-security-token": token,
      },
      timeout: 60_000,
    };

    const req = https.default.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, statusCode: res.statusCode });
        } else {
          reject(new Error(`COS 上传失败 HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("COS 上传超时"));
    });
    req.write(fileContent);
    req.end();
  });
}

/**
 * 添加知识到 IMA
 */
async function addKnowledge(credentials, kbId, folderId, mediaType, mediaId, title, fileInfo) {
  const body = {
    media_type: mediaType,
    media_id: mediaId,
    title,
    knowledge_base_id: kbId,
    ...(folderId ? { folder_id: folderId } : {}),
  };
  if (fileInfo) {
    body.file_info = fileInfo;
  }
  return imaPost("openapi/wiki/v1/add_knowledge", body, credentials);
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────

/**
 * 步骤 1：生成 Q&A Markdown
 * @param {object} params
 * @param {string} params.documentId
 * @param {object} params.document - 包含 title, body
 * @param {array}  params.notes - 笔记数组
 * @param {string} params.vaultRoot
 * @param {function} params.spawnImpl
 * @param {function} params.detectImpl
 * @returns {{ markdown: string, fileName: string }}
 */
export async function generateQnAMarkdown({
  document,
  notes,
  vaultRoot = DEFAULT_VAULT_ROOT,
  spawnImpl = spawnProcess,
  detectImpl = detectCodexCli,
} = {}) {
  const codexPath = await detectImpl();
  if (!codexPath?.executablePath) {
    throw new Error("Codex CLI 不可用，无法生成 Q&A。");
  }

  const prompt = buildQnAGeneratePrompt({
    documentTitle: document?.title || "未命名文章",
    sourceContent: document?.body || "",
    notes: notes || [],
  });

  const tmpDir = await mkdtemp(join(tmpdir(), "qna-gen-"));

  // 移除 --output-schema 和 --output-last-message，直接解析 stdout
  const args = [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--ignore-user-config",
    "--ignore-rules",
    "--color",
    "never",
    "-",
  ];

  // 使用 child_process 执行
  const completed = await new Promise((resolve, reject) => {
    const proc = spawnImpl(codexPath.executablePath, args, {
      cwd: tmpDir,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill("SIGKILL"); } catch {}
      resolve({ code: -1, stdout, stderr, timeout: true });
    }, 120_000);

    proc.stdin.write(prompt);
    proc.stdin.end();

    proc.stdout.on("data", (chunk) => (stdout += chunk));
    proc.stderr.on("data", (chunk) => (stderr += chunk));

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
  });

  if (completed.code !== 0) {
    throw new Error(`Codex 生成 Q&A 失败（退出码 ${completed.code}）：${completed.stderr.slice(0, 300) || completed.stdout.slice(0, 300)}`);
  }

  // 从 stdout 提取 Codex 的响应（跳过开头的元数据）
  const lines = completed.stdout.split('\n');
  let markdownStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('codex')) {
      markdownStart = i + 1;
      break;
    }
  }

  let rawResult = markdownStart >= 0 ? lines.slice(markdownStart).join('\n') : completed.stdout;
  rawResult = rawResult.trim();

  if (!rawResult || rawResult.length < 20) {
    throw new Error("生成的 Q&A 内容过短，请重试。");
  }

  const fileName = safeFileName(document?.title, "问答");
  return { markdown: rawResult, fileName };
}

/**
 * 步骤 2：将 Q&A Markdown 写入 IMA 知识库
 * @param {object} params
 * @param {string} params.markdown - Q&A Markdown 内容
 * @param {string} params.fileName - 文件名（含 .md 后缀）
 * @param {string} [params.kbId] - 知识库 ID（默认用 AI 与教育）
 * @param {string} [params.folderId] - 目标文件夹 ID（可选，不传则自动定位）
 * @returns {{ mediaId: string, title: string, folderId: string }}
 */
export async function exportQnaToIma({
  markdown,
  fileName,
  kbId = DEFAULT_KB_ID,
  folderId: overrideFolderId,
} = {}) {
  const creds = loadImaCredentials();
  if (!creds) {
    throw new Error("未配置 IMA 凭证（需要 IMA_CLIENT_ID 和 IMA_API_KEY 环境变量）。");
  }

  // 1. 确定目标文件夹
  let targetFolderId = overrideFolderId;
  if (!targetFolderId) {
    const folderInfo = await locateTargetFolder(creds, kbId);
    targetFolderId = folderInfo;
  }

  // 2. 检查重复
  const repeatResult = await checkRepeatedNames(creds, kbId, targetFolderId, fileName);
  if (repeatResult.code !== 0) {
    throw new Error(`检查文件名失败：${repeatResult.msg}`);
  }
  const isRepeated = (repeatResult.data?.results || []).some((r) => r.is_repeated);
  if (isRepeated) {
    // 追加时间戳
    const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    fileName = fileName.replace(/\.md$/, `_${ts}.md`);
  }

  // 3. 创建媒体
  const fileSize = Buffer.byteLength(markdown, "utf8");
  const mediaResult = await createMedia(creds, kbId, fileName, fileSize, targetFolderId);
  if (mediaResult.code !== 0) {
    throw new Error(`创建媒体失败：${mediaResult.msg}`);
  }
  const { media_id, cos_credential } = mediaResult.data || {};
  if (!media_id || !cos_credential) {
    throw new Error("create_media 未返回必要字段。");
  }

  // 4. COS 上传
  const contentBuffer = Buffer.from(markdown, "utf8");
  await writeFile(join(tmpdir(), fileName), markdown, "utf8");
  const uploadResult = await uploadToCos(creds, cos_credential, fileName, contentBuffer);

  // 5. add_knowledge
  const addResult = await addKnowledge(creds, kbId, targetFolderId, 7, media_id, fileName, {
    cos_key: cos_credential.cos_key,
    file_size: fileSize,
    file_name: fileName,
  });

  if (addResult.code !== 0) {
    throw new Error(`添加知识失败：${addResult.msg}`);
  }

  return {
    mediaId: addResult.data?.media_id || media_id,
    title: fileName,
    folderId: targetFolderId,
  };
}
