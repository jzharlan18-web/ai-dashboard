/**
 * 成绩分析任务执行器
 *
 * 功能：在工作台内直接 spawn gen_zx.py + extract_profile.py，
 * 实现"一键分析"——无需切换到 WorkBuddy 对话。
 *
 * 设计参考 codex-runner.mjs 的 job 管理模式：
 *   queued → running → completed / failed
 *
 * 两阶段链式执行：
 *   Stage 1: gen_zx.py --detail <file> --summary <file> --output-dir <dir> --date <YYYYMMDD>
 *   Stage 2: extract_profile.py（仅 stage1 成功才执行）
 *
 * 安全边界：
 *   - 文件路径必须在 SCORES_DIR 或 Downloads 目录下（白名单校验）
 *   - 只 spawn 固定的 Python 解释器和固定脚本
 *   - 不接受任意命令行参数注入
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// ── 常量 ──
export const SCORE_JOB_STATUS = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const PYTHON_BIN =
  "/Users/mac/.workbuddy/binaries/python/envs/default/bin/python3";
const GEN_ZX_SCRIPT = "/Users/mac/workspace/sun-ai-workspace/成绩分析/gen_zx.py";
const EXTRACT_SCRIPT =
  "/Users/mac/workspace/sun-ai-workspace/成绩分析/extract_profile.py";
const SCORES_DIR = "/Users/mac/workspace/sun-ai-workspace/成绩分析";
const DOWNLOADS_DIR = "/Users/mac/Downloads";

const MAX_STDOUT_BYTES = 512 * 1024; // 512 KB
const MAX_STDERR_BYTES = 64 * 1024; // 64 KB
const DEFAULT_TIMEOUT_MS = 120 * 1000; // 2 min per stage

const TERMINAL_STATES = new Set([
  SCORE_JOB_STATUS.COMPLETED,
  SCORE_JOB_STATUS.FAILED,
  SCORE_JOB_STATUS.CANCELLED,
]);

// ── 允许的目录白名单 ──
const ALLOWED_DIRS = [
  path.resolve(SCORES_DIR),
  path.resolve(DOWNLOADS_DIR),
];

function isPathAllowed(filePath) {
  const resolved = path.resolve(filePath);
  return ALLOWED_DIRS.some((dir) => resolved.startsWith(dir + path.sep) || resolved === dir);
}

// ── 日期工具 ──
function todayYYYYMMDD() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// ── 文件扫描：从 Downloads 和成绩分析目录寻找候选文件 ──
export function scanScoreStaging() {
  const candidates = { detail: [], summary: [] };

  const scanDirs = [DOWNLOADS_DIR, SCORES_DIR];
  for (const dir of scanDirs) {
    if (!existsSync(dir)) continue;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;

      // 小题得分明细 (.xlsx)
      if (
        (entry.endsWith(".xlsx") || entry.endsWith(".zip")) &&
        entry.includes("明细")
      ) {
        candidates.detail.push({
          fileName: entry,
          dir,
          fullPath,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        });
      }

      // 小题得分情况 (.xls)
      if (
        entry.endsWith(".xls") &&
        (entry.includes("得分情况") || entry.includes("小题"))
      ) {
        candidates.summary.push({
          fileName: entry,
          dir,
          fullPath,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        });
      }
    }
  }

  // 按 mtime 降序（最新在前）
  candidates.detail.sort((a, b) => b.mtime > a.mtime ? 1 : -1);
  candidates.summary.sort((a, b) => b.mtime > a.mtime ? 1 : -1);

  return {
    scannedAt: new Date().toISOString(),
    downloadsDir: DOWNLOADS_DIR,
    scoresDir: SCORES_DIR,
    candidates,
  };
}

// ── Job 管理 ──
export function createScoreRunner({
  spawnImpl = spawn,
  idFactory = randomUUID,
  now = () => new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const jobs = new Map();

  function requireJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) {
      const error = new Error(`成绩分析任务不存在：${jobId}`);
      error.code = "SCORE_JOB_NOT_FOUND";
      throw error;
    }
    return job;
  }

  function publicJob(job) {
    return {
      id: job.id,
      status: job.status,
      stage: job.stage,
      detailFile: job.detailFile,
      summaryFile: job.summaryFile,
      examDate: job.examDate,
      stdout: job.stdout,
      stderr: job.stderr,
      outputFile: job.outputFile,
      outputHtml: job.outputHtml,
      error: job.error ? { code: job.error.code, message: job.error.message } : null,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      events: job.events.map((e) => ({ ...e })),
    };
  }

  function addEvent(job, type, message = "") {
    job.events.push({ type, message, at: now().toISOString() });
    if (job.events.length > 50) job.events.shift();
  }

  function appendBounded(current, chunk, maxBytes) {
    const combined = current + chunk;
    if (Buffer.byteLength(combined, "utf8") <= maxBytes) return combined;
    return Buffer.from(combined, "utf8").subarray(0, maxBytes).toString("utf8");
  }

  /**
   * 创建并启动分析任务
   */
  function createAnalysisJob({ detailFile, summaryFile, examDate }) {
    // 校验文件路径安全性
    if (!detailFile || !summaryFile) {
      const error = new Error("必须提供明细文件和题目文件路径。");
      error.code = "MISSING_FILES";
      throw error;
    }
    if (!isPathAllowed(detailFile)) {
      const error = new Error(`文件路径不在允许的目录内：${detailFile}`);
      error.code = "PATH_NOT_ALLOWED";
      throw error;
    }
    if (!isPathAllowed(summaryFile)) {
      const error = new Error(`文件路径不在允许的目录内：${summaryFile}`);
      error.code = "PATH_NOT_ALLOWED";
      throw error;
    }
    if (!existsSync(detailFile)) {
      const error = new Error(`明细文件不存在：${detailFile}`);
      error.code = "DETAIL_FILE_NOT_FOUND";
      throw error;
    }
    if (!existsSync(summaryFile)) {
      const error = new Error(`题目文件不存在：${summaryFile}`);
      error.code = "SUMMARY_FILE_NOT_FOUND";
      throw error;
    }

    const date = (examDate || todayYYYYMMDD()).trim();

    const jobId = idFactory();
    const job = {
      id: jobId,
      status: SCORE_JOB_STATUS.QUEUED,
      stage: null,
      detailFile,
      summaryFile,
      examDate: date,
      stdout: "",
      stderr: "",
      outputFile: null,
      outputHtml: null,
      error: null,
      createdAt: now().toISOString(),
      startedAt: null,
      finishedAt: null,
      events: [],
    };
    jobs.set(jobId, job);

    // 异步启动
    runAnalysis(job).catch((err) => {
      job.status = SCORE_JOB_STATUS.FAILED;
      job.error = { code: "RUNNER_UNEXPECTED", message: err.message };
      job.finishedAt = now().toISOString();
    });

    return publicJob(job);
  }

  /**
   * 异步执行两阶段分析链
   */
  async function runAnalysis(job) {
    if (job.status === SCORE_JOB_STATUS.CANCELLED) return;

    // ── Stage 1: gen_zx.py ──
    job.status = SCORE_JOB_STATUS.RUNNING;
    job.stage = "report";
    job.startedAt = now().toISOString();
    addEvent(job, "stage_start", "生成成绩报表 (gen_zx.py)");

    const stage1Success = await runProcess(job, {
      executable: PYTHON_BIN,
      args: [
        GEN_ZX_SCRIPT,
        "--detail", job.detailFile,
        "--summary", job.summaryFile,
        "--output-dir", SCORES_DIR,
        "--date", job.examDate,
      ],
      cwd: SCORES_DIR,
    });

    if (!stage1Success) {
      job.status = SCORE_JOB_STATUS.FAILED;
      job.error = {
        code: "GEN_ZX_FAILED",
        message: "成绩报表生成失败，请检查 stderr 输出。",
      };
      job.finishedAt = now().toISOString();
      addEvent(job, "stage_failed", "报表生成失败");
      return;
    }

    // 从 stdout 最后一行尝试提取输出文件名
    job.outputFile = extractOutputFile(job.stdout, job.examDate);
    addEvent(job, "stage_complete", `报表已生成: ${job.outputFile || "未知文件名"}`);

    if (job.status === SCORE_JOB_STATUS.CANCELLED) return;

    // ── Stage 2: extract_profile.py ──
    job.stage = "profile";
    addEvent(job, "stage_start", "提取学生画像 (extract_profile.py)");

    const stage2Success = await runProcess(job, {
      executable: PYTHON_BIN,
      args: [EXTRACT_SCRIPT],
      cwd: SCORES_DIR,
      resetStdout: true,
    });

    if (!stage2Success) {
      job.status = SCORE_JOB_STATUS.FAILED;
      job.error = {
        code: "EXTRACT_FAILED",
        message: "学生画像提取失败，但报表可能已生成。请检查。",
      };
      job.finishedAt = now().toISOString();
      addEvent(job, "stage_failed", "画像提取失败");
      return;
    }

    job.outputHtml = path.join(SCORES_DIR, "学生画像查询.html");
    job.status = SCORE_JOB_STATUS.COMPLETED;
    job.finishedAt = now().toISOString();
    addEvent(job, "job_complete", "全部分析完成");
  }

  /**
   * spawn 一个进程并收集输出
   */
  function runProcess(job, { executable, args, cwd, resetStdout = false }) {
    return new Promise((resolve) => {
      if (resetStdout) job.stdout = "";
      let child;
      try {
        child = spawnImpl(executable, args, {
          cwd,
          env: process.env,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        job.stderr = appendBounded(job.stderr, `\n[spawn error] ${err.message}\n`, MAX_STDERR_BYTES);
        resolve(false);
        return;
      }

      const timer = setTimeout(() => {
        try { child.kill("SIGTERM"); } catch {}
        job.stderr = appendBounded(job.stderr, "\n[timeout] 进程超时被终止\n", MAX_STDERR_BYTES);
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        job.stdout = appendBounded(job.stdout, chunk.toString("utf8"), MAX_STDOUT_BYTES);
      });
      child.stderr.on("data", (chunk) => {
        job.stderr = appendBounded(job.stderr, chunk.toString("utf8"), MAX_STDERR_BYTES);
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        job.stderr = appendBounded(job.stderr, `\n[error] ${err.message}\n`, MAX_STDERR_BYTES);
        resolve(false);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    });
  }

  function getJob(jobId) {
    return publicJob(requireJob(jobId));
  }

  function listJobs() {
    return Array.from(jobs.values())
      .sort((a, b) => b.createdAt > a.createdAt ? 1 : -1)
      .map(publicJob);
  }

  function cancelJob(jobId) {
    const job = requireJob(jobId);
    if (TERMINAL_STATES.has(job.status)) {
      return publicJob(job);
    }
    job.status = SCORE_JOB_STATUS.CANCELLED;
    job.finishedAt = now().toISOString();
    addEvent(job, "cancelled", "用户取消");
    return publicJob(job);
  }

  return {
    createAnalysisJob,
    getJob,
    listJobs,
    cancelJob,
  };
}

// ── 工具：从 gen_zx.py 的 stdout 推导输出文件名 ──
function extractOutputFile(stdout, datePrefix) {
  // gen_zx.py 不会明确打印输出路径，从已知规律推导
  // 尝试从 stderr/stdout 中匹配
  const match = stdout.match(/([^\s]+\.(?:xlsx))/);
  if (match) return match[1];
  // fallback：不返回猜测值
  return null;
}
