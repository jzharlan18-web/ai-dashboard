import { readFile } from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * 成绩分析数据服务
 *
 * 数据来源：
 *   1. 成绩分析/profile_data.json  — extract_profile.py 生成的前端数据结构
 *   2. 成绩分析/*语文成绩分析.xlsx  — gen_zx.py 生成的报表（用于文件列表/时间戳）
 *
 * 暴露给 vite-plugin-workbench.mjs：
 *   - buildScoresPayload(scoresDir)  →  /api/scores 的返回体
 */

const DEFAULT_SCORES_DIR = "/Users/mac/workspace/sun-ai-workspace/成绩分析";

/**
 * 安全读取 JSON 文件
 */
async function readJsonFile(filePath) {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 扫描成绩分析目录下的 Excel 报表文件，返回按文件名排序的列表。
 * 文件名格式：YYYYMMDD-考试名-语文成绩分析.xlsx
 */
function scanExcelFiles(scoresDir) {
  if (!existsSync(scoresDir)) return [];
  try {
    return readdirSync(scoresDir)
      .filter((f) => f.endsWith("语文成绩分析.xlsx"))
      .map((f) => {
        const fullPath = path.join(scoresDir, f);
        const stat = statSync(fullPath);
        // 从文件名提取日期和考试名
        const match = f.match(/^(\d{8})-(.+)-语文成绩分析\.xlsx$/);
        const dateStr = match ? match[1] : null;
        const examName = match ? match[2] : f.replace(/\.xlsx$/, "");
        return {
          fileName: f,
          dateStr,
          examName,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => (a.fileName < b.fileName ? -1 : 1));
  } catch {
    return [];
  }
}

/**
 * 从 profile_data.json 中提取最新考试的班级概览。
 *
 * profile_data.json 结构：
 *   { exams: ["考试名1", ...], students: { "准考证号": { name, exams: { "考试名": { total, banci, ... } } } } }
 */
function extractLatestExamSummary(data) {
  if (!data || !data.exams || data.exams.length === 0) return null;

  const latestExam = data.exams[data.exams.length - 1];
  const students = Object.entries(data.students);
  if (students.length === 0) return null;

  // 收集本次考试所有有效学生
  const records = [];
  for (const [zkzh, stu] of students) {
    const examData = stu.exams?.[latestExam];
    if (!examData || !examData.total || examData.total <= 0) continue;
    records.push({ zkzh, name: stu.name, ...examData });
  }
  if (records.length === 0) return null;

  records.sort((a, b) => b.total - a.total);

  const n = records.length;
  const totalSum = records.reduce((s, r) => s + r.total, 0);
  const avgTotal = totalSum / n;

  const passCount = records.filter((r) => r.total >= 90).length;
  const excellentCount = records.filter((r) => r.total >= 120).length;
  const passRate = passCount / n;
  const excellentRate = excellentCount / n;

  // 标准差
  const variance = records.reduce((s, r) => s + Math.pow(r.total - avgTotal, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  // 临界生（85-89 分段）
  const criticalCount = records.filter((r) => r.total >= 85 && r.total < 90).length;

  // 位次段分布
  const segDist = { top10: 0, upperMid: 0, mid: 0, lower: 0 };
  for (const r of records) {
    const banci = r.banci;
    if (banci == null) continue;
    if (banci <= 10) segDist.top10++;
    else if (banci <= 30) segDist.upperMid++;
    else if (banci <= 50) segDist.mid++;
    else segDist.lower++;
  }

  // 教学模块得分率（最新考试的模块聚合）
  const moduleMap = {};
  for (const r of records) {
    if (!r.modules) continue;
    for (const [modName, modData] of Object.entries(r.modules)) {
      if (!moduleMap[modName]) {
        moduleMap[modName] = { scoreSum: 0, fullSum: 0, count: 0 };
      }
      moduleMap[modName].scoreSum += modData.score || 0;
      moduleMap[modName].fullSum += modData.full || 0;
      moduleMap[modName].count++;
    }
  }
  const moduleRates = Object.entries(moduleMap)
    .map(([name, info]) => ({
      name,
      rate: info.fullSum > 0 ? info.scoreSum / info.fullSum : 0,
      avgScore: info.count > 0 ? info.scoreSum / info.count : 0,
      fullMark: info.count > 0 ? info.fullSum / info.count : 0,
    }))
    .sort((a, b) => b.rate - a.rate);

  // 薄弱模块（得分率最低的 3 个）
  const weakModules = [...moduleRates].sort((a, b) => a.rate - b.rate).slice(0, 3);

  return {
    examName: latestExam,
    studentCount: n,
    avgTotal: Math.round(avgTotal * 10) / 10,
    passRate: Math.round(passRate * 1000) / 10,
    excellentRate: Math.round(excellentRate * 1000) / 10,
    stdDev: Math.round(stdDev * 10) / 10,
    criticalCount,
    maxScore: records[0]?.total ?? null,
    minScore: records[n - 1]?.total ?? null,
    segDist,
    moduleRates,
    weakModules,
  };
}

/**
 * 构建多次考试趋势（跨考试的班级均分/及格率变化）
 */
function buildExamTrend(data) {
  if (!data || !data.exams || data.exams.length === 0) return [];

  return data.exams.map((examName, idx) => {
    const students = Object.values(data.students);
    const records = [];
    for (const stu of students) {
      const ed = stu.exams?.[examName];
      if (!ed || !ed.total || ed.total <= 0) continue;
      records.push(ed);
    }
    if (records.length === 0) return { examName, index: idx, studentCount: 0 };

    const n = records.length;
    const totalSum = records.reduce((s, r) => s + r.total, 0);
    const avg = totalSum / n;
    const passCount = records.filter((r) => r.total >= 90).length;

    return {
      examName,
      index: idx,
      studentCount: n,
      avgTotal: Math.round(avg * 10) / 10,
      passRate: Math.round((passCount / n) * 1000) / 10,
    };
  });
}

/**
 * 构建教师视图的学生画像列表（最新考试画像 + 历次总分趋势）。
 *
 * 返回按班排升序的学生数组，每个学生：
 *   { zkzh, name, total, banci, nianci, seg, strong, weak, comment,
 *     modules: [{name, score, full, rate}], trend: [{examName, total, banci, nianci}] }
 *
 * trend 按 data.exams 顺序排列（考试顺序），缺失的考试跳过。
 */
function buildStudentPortraits(data) {
  if (!data || !data.exams || data.exams.length === 0) return [];
  const latestExam = data.exams[data.exams.length - 1];
  const students = Object.entries(data.students ?? {});
  if (students.length === 0) return [];

  const rows = [];
  for (const [zkzh, stu] of students) {
    const examData = stu.exams?.[latestExam];
    if (!examData || !examData.total || examData.total <= 0) continue;

    // 模块得分率（最新考试）
    const modules = examData.modules
      ? Object.entries(examData.modules)
          .map(([name, m]) => ({
            name,
            score: m.score ?? 0,
            full: m.full ?? 0,
            rate: m.full > 0 ? m.score / m.full : 0,
          }))
          .sort((a, b) => a.rate - b.rate)
      : [];

    // 历次总分趋势（按考试顺序）
    const trend = data.exams
      .filter((en) => stu.exams?.[en] && stu.exams[en].total > 0)
      .map((en) => ({
        examName: en,
        total: stu.exams[en].total,
        banci: stu.exams[en].banci ?? null,
        nianci: stu.exams[en].nianci ?? null,
      }));

    rows.push({
      zkzh,
      name: stu.name,
      total: examData.total,
      banci: examData.banci ?? null,
      nianci: examData.nianci ?? null,
      seg: examData.seg ?? "",
      strong: examData.strong ?? "",
      weak: examData.weak ?? "",
      comment: examData.comment ?? "",
      modules,
      trend,
    });
  }

  // 按班排升序（无班排的排最后）
  rows.sort((a, b) => {
    const ba = a.banci ?? 9999;
    const bb = b.banci ?? 9999;
    return ba - bb;
  });

  return rows;
}

/**
 * 主入口：构建 /api/scores 响应体
 */
export async function buildScoresPayload(scoresDir = DEFAULT_SCORES_DIR) {
  const jsonPath = path.join(scoresDir, "profile_data.json");
  const data = await readJsonFile(jsonPath);

  if (!data) {
    return {
      available: false,
      message: "未找到 profile_data.json，请先运行成绩分析生成报表和学生画像数据。",
      scoresDir,
      exams: [],
      excelFiles: [],
      latest: null,
      trend: [],
    };
  }

  const excelFiles = scanExcelFiles(scoresDir);
  const latest = extractLatestExamSummary(data);
  const trend = buildExamTrend(data);
  const students = buildStudentPortraits(data);

  return {
    available: true,
    generatedAt: new Date().toISOString(),
    scoresDir,
    excelFiles,
    examCount: data.exams?.length ?? 0,
    studentCount: Object.keys(data.students ?? {}).length,
    moduleKeys: data.moduleKeys ?? [],
    typeKeys: data.typeKeys ?? [],
    latest,
    trend,
    students,
  };
}
