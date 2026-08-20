import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

function resolveTopicPath(vaultRoot, topicPath) {
  const fullPath = path.join(vaultRoot, topicPath);
  if (!fullPath.startsWith(path.resolve(vaultRoot))) {
    throw new Error("Invalid topic path");
  }
  return fullPath;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function compactDatestamp() {
  // YYYYMMDD — used in versioned filenames for chronological sort
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * writeDeliverable — 版本化交付。
 *
 * 首次交付：文件名 `<base>-成品稿.md`，production_file 指向它。
 * 重交付（已有 production_file）：生成 `<base>-成品稿-vN-YYYYMMDD.md`，
 *   旧稿保留不删；production_file 指向新稿；production_history 追加一条。
 *
 * @param {object} deliverable  { title, body }
 * @param {string} [reworkNote] 重交付时用户填的"本次要规避的问题"
 */
export async function writeDeliverable(vaultRoot, topicPath, deliverable, reworkNote = "") {
  const fullPath = resolveTopicPath(vaultRoot, topicPath);
  const raw = await fs.readFile(fullPath, "utf-8");
  const parsed = matter(raw);

  parsed.data.conditions_finalized = true;
  parsed.data.production_status = "delivered";

  const today = todayISO();
  parsed.data.delivered_at = today;
  parsed.data.deliverable_title = deliverable.title;

  const publishedDir = path.join(vaultRoot, "40_topics", "published");
  await fs.mkdir(publishedDir, { recursive: true });

  const baseName = path.basename(topicPath, ".md");

  // 判断是否已有交付历史
  const existingHistory = Array.isArray(parsed.data.production_history)
    ? parsed.data.production_history
    : [];
  const isFirstDelivery = !parsed.data.production_file && existingHistory.length === 0;

  let deliverableFileName;
  let newVersionNumber;

  if (isFirstDelivery) {
    // 首次：简洁文件名
    newVersionNumber = 1;
    deliverableFileName = `${baseName}-成品稿.md`;
  } else {
    // 重交付：版本号 = 历史长度 + 1（旧稿入史）
    newVersionNumber = existingHistory.length + 1;
    const stamp = compactDatestamp();
    deliverableFileName = `${baseName}-成品稿-v${newVersionNumber}-${stamp}.md`;
  }

  const deliverablePath = path.join(publishedDir, deliverableFileName);

  // 如果是重交付，先把当前 production_file（旧最新稿）归档进 production_history
  if (!isFirstDelivery && parsed.data.production_file) {
    const oldEntry = {
      version: existingHistory.length, // 旧稿的版本号
      file: parsed.data.production_file,
      generated_at: parsed.data.delivered_at || today,
    };
    existingHistory.push(oldEntry);
  }

  // 写入新成品稿
  const deliverableContent = [
    "---",
    `title: ${deliverable.title}`,
    "type: deliverable",
    `source_topic: ${topicPath}`,
    `content_format: ${parsed.data.content_format || "未指定"}`,
    `series: ${parsed.data.series || "未分类"}`,
    `delivered_at: ${today}`,
    `version: ${newVersionNumber}`,
    reworkNote ? `rework_note: ${JSON.stringify(reworkNote)}` : null,
    "---",
    "",
    deliverable.body,
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");

  await fs.writeFile(deliverablePath, deliverableContent, "utf-8");

  // 更新选题文件的版本元数据
  const newHistoryEntry = {
    version: newVersionNumber,
    file: `40_topics/published/${deliverableFileName}`,
    generated_at: today,
  };
  if (reworkNote) {
    newHistoryEntry.rework_note = reworkNote;
  }
  existingHistory.push(newHistoryEntry);

  parsed.data.production_history = existingHistory;
  parsed.data.production_file = `40_topics/published/${deliverableFileName}`;

  const updatedRaw = matter.stringify(parsed.content, parsed.data, { lineWidth: -1 });
  await fs.writeFile(fullPath, updatedRaw, "utf-8");

  const relativeDeliverablePath = path.relative(vaultRoot, deliverablePath);
  return {
    deliverablePath: relativeDeliverablePath,
    title: deliverable.title,
    version: newVersionNumber,
    isFirstDelivery,
  };
}

/**
 * readPreviousDraft — 读取旧成品稿正文，供重交付时让 Codex 对照。
 * 失败（文件不存在等）时返回空字符串，不阻断流程。
 */
export async function readPreviousDraft(vaultRoot, productionFile) {
  if (!productionFile) return "";
  try {
    const fullPath = path.join(vaultRoot, productionFile);
    if (!fullPath.startsWith(path.resolve(vaultRoot))) return "";
    const raw = await fs.readFile(fullPath, "utf-8");
    const parsed = matter(raw);
    return parsed.content || raw;
  } catch {
    return "";
  }
}
