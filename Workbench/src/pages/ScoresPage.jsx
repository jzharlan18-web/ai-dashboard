import { useEffect, useState, useRef, useCallback } from "react";
import {
  IconChartBar,
  IconAlertTriangle,
  IconCheck,
  IconFileSpreadsheet,
  IconPlayerPlay,
  IconLoader2,
  IconX,
  IconRefresh,
  IconSearch,
  IconChevronDown,
  IconChevronRight,
} from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import {
  loadScores,
  scanScoreStaging,
  startScoreAnalysis,
  getScoreJobStatus,
  cancelScoreJob,
} from "../lib/api";

/* ── 内联 SVG 图表组件 ── */

/** 教学模块得分率水平柱状图 */
function ModuleBarChart({ modules }) {
  if (!modules || modules.length === 0) return null;
  const maxRate = 1;
  const barHeight = 28;
  const gap = 10;
  const labelWidth = 120;
  const chartWidth = 280;
  const totalHeight = modules.length * (barHeight + gap) + gap;

  return (
    <svg
      viewBox={`0 0 ${labelWidth + chartWidth + 60} ${totalHeight}`}
      style={{ width: "100%", height: "auto" }}
    >
      {modules.map((mod, i) => {
        const y = gap + i * (barHeight + gap);
        const barW = mod.rate * chartWidth;
        const isWeak = mod.rate < 0.5;
        const color = isWeak ? "#e85a4f" : mod.rate < 0.7 ? "#f0a050" : "#4caf50";
        return (
          <g key={mod.name}>
            <text
              x={labelWidth - 8}
              y={y + barHeight / 2 + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--text-muted, #666)"
            >
              {mod.name.length > 8 ? mod.name.slice(0, 7) + "…" : mod.name}
            </text>
            <rect
              x={labelWidth}
              y={y}
              width={chartWidth}
              height={barHeight}
              rx="3"
              fill="var(--surface-alt, #f0f0f0)"
            />
            <rect
              x={labelWidth}
              y={y}
              width={barW}
              height={barHeight}
              rx="3"
              fill={color}
              opacity="0.85"
            />
            <text
              x={labelWidth + barW + 6}
              y={y + barHeight / 2 + 4}
              fontSize="11"
              fontWeight="600"
              fill={color}
            >
              {(mod.rate * 100).toFixed(1)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** 考试趋势折线图（均分变化） */
function TrendChart({ trend }) {
  if (!trend || trend.length < 2) return null;
  const w = 320;
  const h = 120;
  const pad = { left: 36, right: 16, top: 16, bottom: 28 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  const avgs = trend.map((t) => t.avgTotal || 0);
  const minV = Math.min(...avgs) - 5;
  const maxV = Math.max(...avgs) + 5;
  const range = maxV - minV || 1;

  const points = trend.map((t, i) => {
    const x = pad.left + (cw * i) / (trend.length - 1);
    const y = pad.top + ch - ((t.avgTotal - minV) / range) * ch;
    return { x, y, ...t };
  });

  const pathD = points
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto" }}>
      {/* Y 轴刻度 */}
      <text x={pad.left - 6} y={pad.top + 4} textAnchor="end" fontSize="9" fill="var(--text-muted, #999)">
        {maxV.toFixed(0)}
      </text>
      <text x={pad.left - 6} y={pad.top + ch} textAnchor="end" fontSize="9" fill="var(--text-muted, #999)">
        {minV.toFixed(0)}
      </text>
      {/* 折线 */}
      <path d={pathD} fill="none" stroke="#2e75b6" strokeWidth="2" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="3.5" fill="#2e75b6" />
          <text x={p.x} y={h - 10} textAnchor="middle" fontSize="9" fill="var(--text-muted, #666)">
            {p.examName.length > 6 ? p.examName.slice(0, 5) + "…" : p.examName}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** 位次段分布饼图 */
function SegDistribution({ seg }) {
  if (!seg) return null;
  const total = seg.top10 + seg.upperMid + seg.mid + seg.lower;
  if (total === 0) return null;

  const segments = [
    { label: "领先(前10)", count: seg.top10, color: "#4caf50" },
    { label: "中上(11-30)", count: seg.upperMid, color: "#2e75b6" },
    { label: "中等(31-50)", count: seg.mid, color: "#f0a050" },
    { label: "学困(后)", count: seg.lower, color: "#e85a4f" },
  ].filter((s) => s.count > 0);

  const cx = 60;
  const cy = 60;
  const r = 50;
  let currentAngle = -Math.PI / 2;

  const arcs = segments.map((seg) => {
    const angle = (seg.count / total) * 2 * Math.PI;
    const x1 = cx + r * Math.cos(currentAngle);
    const y1 = cy + r * Math.sin(currentAngle);
    const x2 = cx + r * Math.cos(currentAngle + angle);
    const y2 = cy + r * Math.sin(currentAngle + angle);
    const largeArc = angle > Math.PI ? 1 : 0;
    currentAngle += angle;
    return {
      ...seg,
      path: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`,
      pct: ((seg.count / total) * 100).toFixed(0),
    };
  });

  return (
    <div className="scores-seg-chart">
      <svg viewBox="0 0 120 120" style={{ width: 120, height: 120 }}>
        {arcs.map((arc, i) => (
          <path key={i} d={arc.path} fill={arc.color} opacity="0.85" />
        ))}
        <circle cx={cx} cy={cy} r="22" fill="var(--surface, #fff)" />
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--text, #222)">
          {total}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="8" fill="var(--text-muted, #999)">
          总人数
        </text>
      </svg>
      <div className="scores-seg-legend">
        {arcs.map((arc, i) => (
          <div key={i} className="scores-seg-legend-item">
            <span className="scores-seg-dot" style={{ background: arc.color }} />
            <span>{arc.label}</span>
            <strong className="mono">{arc.count}</strong>
            <span className="mono" style={{ marginLeft: 2, opacity: 0.6 }}>
              ({arc.pct}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 学生模块得分率小条（展开详情用） */
function StudentModuleBars({ modules }) {
  if (!modules || modules.length === 0) return null;
  return (
    <div className="stu-module-bars">
      {modules.map((m) => {
        const color = m.rate < 0.5 ? "#e85a4f" : m.rate < 0.7 ? "#f0a050" : "#4caf50";
        return (
          <div className="stu-module-row" key={m.name}>
            <span className="stu-module-name" title={m.name}>
              {m.name}
            </span>
            <span className="stu-module-track">
              <span
                className="stu-module-fill"
                style={{ width: `${Math.min(m.rate, 1) * 100}%`, background: color }}
              />
            </span>
            <span className="stu-module-rate mono" style={{ color }}>
              {(m.rate * 100).toFixed(0)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 学生历次总分趋势小折线（≥2 次才显示） */
function StudentTrend({ trend }) {
  if (!trend || trend.length < 2) return null;
  const w = 260;
  const h = 72;
  const pad = { left: 30, right: 12, top: 12, bottom: 18 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;
  const totals = trend.map((t) => t.total);
  const minV = Math.min(...totals) - 5;
  const maxV = Math.max(...totals) + 5;
  const range = maxV - minV || 1;
  const points = trend.map((t, i) => {
    const x = pad.left + (cw * i) / (trend.length - 1);
    const y = pad.top + ch - ((t.total - minV) / range) * ch;
    return { x, y, ...t };
  });
  const pathD = points
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="stu-trend-svg">
      <path d={pathD} fill="none" stroke="#2e75b6" strokeWidth="2" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="3" fill="#2e75b6" />
          <text x={p.x} y={h - 4} textAnchor="middle" fontSize="8" fill="var(--text-muted, #999)">
            {p.total}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** 教师视图：学生画像面板 */
function StudentPortraitPanel({ students, examName }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(null);

  if (!students || students.length === 0) return null;

  const filtered = query.trim()
    ? students.filter(
        (s) =>
          s.name.includes(query.trim()) ||
          String(s.zkzh).includes(query.trim()),
      )
    : students;

  return (
    <section className="panel scores-student-panel" data-panel>
      <div className="panel__head">
        <div>
          <span className="eyebrow">STUDENT PORTRAIT</span>
          <h2 className="panel__title" style={{ marginTop: 8 }}>
            学生画像 · {examName}
          </h2>
        </div>
        <div className="stu-search">
          <IconSearch size={14} stroke={1.6} />
          <input
            type="text"
            placeholder="搜姓名 / 准考证号…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="stu-table">
        <div className="stu-table__head">
          <span className="stu-col stu-col--rank">班排</span>
          <span className="stu-col stu-col--name">姓名</span>
          <span className="stu-col stu-col--score">总分</span>
          <span className="stu-col stu-col--rank">年排</span>
          <span className="stu-col stu-col--seg">位次段</span>
          <span className="stu-col stu-col--sw">优势</span>
          <span className="stu-col stu-col--sw">劣势</span>
          <span className="stu-col stu-col--toggle" />
        </div>

        {filtered.map((s) => {
          const open = expanded === s.zkzh;
          return (
            <div className={`stu-row ${open ? "stu-row--open" : ""}`} key={s.zkzh}>
              <button
                className="stu-row__main"
                onClick={() => setExpanded(open ? null : s.zkzh)}
              >
                <span className="stu-col stu-col--rank mono">{s.banci ?? "—"}</span>
                <span className="stu-col stu-col--name">{s.name}</span>
                <span className="stu-col stu-col--score mono">{s.total}</span>
                <span className="stu-col stu-col--rank mono">{s.nianci ?? "—"}</span>
                <span className="stu-col stu-col--seg">{s.seg}</span>
                <span className="stu-col stu-col--sw stu-col--strong" title={s.strong}>
                  {s.strong}
                </span>
                <span className="stu-col stu-col--sw stu-col--weak" title={s.weak}>
                  {s.weak}
                </span>
                <span className="stu-col stu-col--toggle">
                  {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                </span>
              </button>

              {open ? (
                <div className="stu-row__detail">
                  <div className="stu-detail__grid">
                    <div>
                      <div className="stu-detail__label">各模块得分率</div>
                      <StudentModuleBars modules={s.modules} />
                    </div>
                    <div>
                      <div className="stu-detail__label">历次总分趋势</div>
                      {s.trend && s.trend.length >= 2 ? (
                        <StudentTrend trend={s.trend} />
                      ) : (
                        <div className="stu-detail__empty">仅 1 次考试，暂无趋势</div>
                      )}
                    </div>
                  </div>
                  {s.comment ? <div className="stu-comment">{s.comment}</div> : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {filtered.length === 0 ? (
          <div className="collection-empty" style={{ padding: "16px 0" }}>
            没有匹配「{query}」的学生
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ── 分析新考试面板 ── */

function AnalysisPanel({ onCompleted }) {
  const [staging, setStaging] = useState(null);
  const [stagingLoading, setStagingLoading] = useState(true);
  const [selectedDetail, setSelectedDetail] = useState("");
  const [selectedSummary, setSelectedSummary] = useState("");
  const [examDate, setExamDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  });
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  // 加载候选文件
  const loadStaging = useCallback(async () => {
    setStagingLoading(true);
    setError(null);
    try {
      const res = await scanScoreStaging();
      setStaging(res);
      // 自动选中最新文件
      const detailFiles = res?.candidates?.detail ?? [];
      const summaryFiles = res?.candidates?.summary ?? [];
      if (detailFiles.length > 0 && !selectedDetail) {
        setSelectedDetail(detailFiles[0].fullPath);
      }
      if (summaryFiles.length > 0 && !selectedSummary) {
        setSelectedSummary(summaryFiles[0].fullPath);
      }
    } catch (err) {
      setError("扫描文件失败：" + (err.message || "未知错误"));
    } finally {
      setStagingLoading(false);
    }
  }, [selectedDetail, selectedSummary]);

  useEffect(() => {
    loadStaging();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 轮询 job 状态
  useEffect(() => {
    if (!job || !job.id) return;
    const terminalStates = new Set(["completed", "failed", "cancelled"]);
    if (terminalStates.has(job.status)) {
      if (job.status === "completed") {
        // 完成后延迟刷新数据
        const timer = setTimeout(() => onCompleted(), 800);
        return () => clearTimeout(timer);
      }
      return;
    }

    pollRef.current = setTimeout(async () => {
      try {
        const updated = await getScoreJobStatus(job.id);
        setJob(updated);
      } catch (err) {
        setError("获取任务状态失败：" + (err.message || ""));
      }
    }, 1500);

    return () => clearTimeout(pollRef.current);
  }, [job, onCompleted]);

  const handleRun = async () => {
    setError(null);
    if (!selectedDetail || !selectedSummary) {
      setError("请先选择明细文件和题目文件。");
      return;
    }
    try {
      const res = await startScoreAnalysis({
        detailFile: selectedDetail,
        summaryFile: selectedSummary,
        examDate,
      });
      setJob(res);
    } catch (err) {
      setError(err.message || "启动分析失败");
    }
  };

  const handleCancel = async () => {
    if (!job?.id) return;
    try {
      await cancelScoreJob(job.id);
      setJob((prev) => ({ ...prev, status: "cancelled" }));
    } catch (err) {
      setError(err.message || "取消失败");
    }
  };

  const isRunning = job && !["completed", "failed", "cancelled"].includes(job.status);

  // 步骤状态判断
  const stepStatus = (stepName) => {
    if (!job) return "pending";
    if (job.status === "failed") {
      if (job.stage === stepName) return "failed";
      // 报表失败 → profile 不执行
      if (job.stage === "report" && stepName === "profile") return "pending";
      if (job.stage === "profile" && stepName === "report") return "done";
      return "pending";
    }
    if (job.status === "completed") return "done";
    if (job.status === "cancelled") return "pending";
    if (job.status === "running") {
      if (job.stage === stepName) return "running";
      if (stepName === "report" && job.stage === "profile") return "done";
      return "pending";
    }
    return "pending";
  };

  const detailFiles = staging?.candidates?.detail ?? [];
  const summaryFiles = staging?.candidates?.summary ?? [];

  return (
    <div className="scores-run-panel">
      <div className="scores-run-head">
        <h3>分析新考试</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="scores-run-hint">
            从智学网导出两个文件到 Downloads，在此一键分析
          </span>
          <button
            onClick={loadStaging}
            disabled={stagingLoading}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              opacity: stagingLoading ? 0.4 : 0.7,
              padding: 4,
              display: "flex",
            }}
            title="重新扫描文件"
          >
            <IconRefresh size={14} />
          </button>
        </div>
      </div>

      {/* 文件选择表单（有任务运行时隐藏） */}
      {!job || ["completed", "failed", "cancelled"].includes(job.status) ? (
        <>
          {detailFiles.length === 0 || summaryFiles.length === 0 ? (
            <div className="scores-no-candidates">
              <IconAlertTriangle size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />
              未在 Downloads 和成绩分析目录找到智学网文件。请先从智学网导出：
              <strong> 小题得分明细 (.xlsx)</strong> 和 <strong>小题得分情况 (.xls)</strong>，
              然后点上方刷新按钮。
            </div>
          ) : null}

          <div className="scores-run-form">
            <div className="scores-field">
              <label className="scores-field__label">小题得分明细</label>
              <select
                className="scores-field__select"
                value={selectedDetail}
                onChange={(e) => setSelectedDetail(e.target.value)}
                disabled={isRunning}
              >
                {detailFiles.length === 0 ? (
                  <option value="">未找到候选文件</option>
                ) : (
                  detailFiles.map((f) => (
                    <option key={f.fullPath} value={f.fullPath}>
                      {f.fileName} ({Math.round(f.size / 1024)}KB)
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="scores-field">
              <label className="scores-field__label">小题得分情况</label>
              <select
                className="scores-field__select"
                value={selectedSummary}
                onChange={(e) => setSelectedSummary(e.target.value)}
                disabled={isRunning}
              >
                {summaryFiles.length === 0 ? (
                  <option value="">未找到候选文件</option>
                ) : (
                  summaryFiles.map((f) => (
                    <option key={f.fullPath} value={f.fullPath}>
                      {f.fileName} ({Math.round(f.size / 1024)}KB)
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="scores-field">
              <label className="scores-field__label">考试日期 (YYYYMMDD)</label>
              <input
                className="scores-field__input"
                type="text"
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
                placeholder="如 20260415"
                maxLength={8}
                disabled={isRunning}
              />
            </div>
          </div>

          {error ? (
            <div className="scores-run-status" style={{ color: "#e85a4f" }}>
              <IconAlertTriangle size={14} />
              {error}
            </div>
          ) : null}

          <div className="scores-run-actions">
            <button
              className="scores-run-btn"
              onClick={handleRun}
              disabled={isRunning || !selectedDetail || !selectedSummary}
            >
              <IconPlayerPlay size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />
              开始分析
            </button>
          </div>
        </>
      ) : null}

      {/* 运行中 / 完成 / 失败的进度面板 */}
      {job ? (
        <div className="scores-run-progress">
          {/* Stage 1: 报表生成 */}
          <div className={`scores-run-step scores-run-step--${stepStatus("report")}`}>
            <span className="scores-run-step__icon">
              {stepStatus("report") === "done" ? "✓" :
               stepStatus("report") === "running" ? "" :
               stepStatus("report") === "failed" ? "✕" : ""}
              {stepStatus("report") === "running" ? (
                <IconLoader2 size={10} style={{ animation: "spin 1s linear infinite" }} />
              ) : null}
            </span>
            <span className="scores-run-step__text">
              {stepStatus("report") === "done" ? "成绩报表已生成" :
               stepStatus("report") === "running" ? "正在生成成绩报表 (gen_zx.py)…" :
               stepStatus("report") === "failed" ? "报表生成失败" :
               "等待生成成绩报表"}
              {job.outputFile && stepStatus("report") === "done" ? ` · ${job.outputFile.split("/").pop()}` : ""}
            </span>
          </div>

          {/* Stage 2: 学生画像 */}
          <div className={`scores-run-step scores-run-step--${stepStatus("profile")}`}>
            <span className="scores-run-step__icon">
              {stepStatus("profile") === "done" ? "✓" :
               stepStatus("profile") === "running" ? "" :
               stepStatus("profile") === "failed" ? "✕" : ""}
              {stepStatus("profile") === "running" ? (
                <IconLoader2 size={10} style={{ animation: "spin 1s linear infinite" }} />
              ) : null}
            </span>
            <span className="scores-run-step__text">
              {stepStatus("profile") === "done" ? "学生画像已更新" :
               stepStatus("profile") === "running" ? "正在提取学生画像 (extract_profile.py)…" :
               stepStatus("profile") === "failed" ? "画像提取失败" :
               "等待提取学生画像"}
            </span>
          </div>

          {/* 成功提示 */}
          {job.status === "completed" ? (
            <div className="scores-run-success">
              <IconCheck size={16} />
              <span>分析完成！看板数据已自动刷新。</span>
            </div>
          ) : null}

          {/* 失败提示 */}
          {job.status === "failed" ? (
            <div className="scores-run-success" style={{
              background: "rgba(232,90,79,0.08)",
              borderColor: "rgba(232,90,79,0.3)",
              color: "#e85a4f",
            }}>
              <IconX size={16} />
              <span>
                {job.error?.message || "分析失败"}
                {job.stage === "report" ? "（报表未生成，请检查文件格式）" : "（报表可能已生成，画像未更新）"}
              </span>
            </div>
          ) : null}

          {/* stderr 输出（失败或运行中） */}
          {(job.status === "failed" || isRunning) && job.stderr ? (
            <details>
              <summary style={{ fontSize: 11, color: "var(--ink-faint)", cursor: "pointer", marginTop: 6 }}>
                查看脚本输出
              </summary>
              <pre className={`scores-run-log ${job.status === "failed" ? "scores-run-log--error" : ""}`}>
                {job.stderr.slice(-2000)}
              </pre>
            </details>
          ) : null}

          {/* 取消按钮 */}
          {isRunning ? (
            <div className="scores-run-actions" style={{ marginTop: 8 }}>
              <button className="scores-run-btn scores-run-btn--cancel" onClick={handleCancel}>
                <IconX size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                取消
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ── 主页面 ── */

export function ScoresPage() {
  const [data, setData] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    loadScores().then((res) => setData(res));
  }, [refreshKey]);

  const handleAnalysisCompleted = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const scores = data?.data;
  const isLoading = !data;
  const unavailable = data?.data?.available === false;

  if (isLoading) {
    return (
      <div>
        <PageHeader eyebrow="SCORE ANALYSIS" title="成绩分析" description="加载中…" />
        <div className="collection-empty">数据加载中…</div>
      </div>
    );
  }

  if (unavailable) {
    return (
      <div>
        <PageHeader
          eyebrow="SCORE ANALYSIS"
          title="成绩分析"
          description="智学网数据驱动的语文成绩看板"
        />
        <AnalysisPanel onCompleted={handleAnalysisCompleted} />
        <div className="panel">
          <div className="collection-empty">
            <IconAlertTriangle size={32} stroke={1.5} style={{ opacity: 0.4, marginBottom: 8 }} />
            <p>{scores?.message || "成绩分析数据暂不可用。"}</p>
            <p style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>
              使用方法：从智学网导出文件 → 在上方面板选择文件 → 点击「开始分析」。
              也可在对话中说「分析这次考试」由 WorkBuddy 处理。
            </p>
          </div>
        </div>
      </div>
    );
  }

  const latest = scores?.latest;
  const trend = scores?.trend ?? [];
  const excelFiles = scores?.excelFiles ?? [];
  const students = scores?.students ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="SCORE ANALYSIS"
        title="成绩分析"
        description={`${latest?.examName || "最新考试"} · ${latest?.studentCount || 0} 名学生`}
        aside={
          <div className="scores-header-meta">
            <span className="badge">
              <IconFileSpreadsheet size={14} stroke={1.6} />
              {excelFiles.length} 份报表
            </span>
            <span className="badge">
              <IconChartBar size={14} stroke={1.6} />
              {trend.length} 次考试
            </span>
          </div>
        }
      />

      {/* 分析新考试操作面板 */}
      <AnalysisPanel onCompleted={handleAnalysisCompleted} />

      {latest ? (
        <>
          {/* 核心指标条 */}
          <div className="metric-strip scores-metric-strip">
            <div className="metric-stat scores-metric">
              <span className="metric-stat__label">班级均分</span>
              <span className="metric-stat__value">{latest.avgTotal}</span>
              <span className="metric-stat__hint">
                最高 {latest.maxScore} · 最低 {latest.minScore}
              </span>
            </div>
            <div className="metric-stat scores-metric">
              <span className="metric-stat__label">及格率(≥90)</span>
              <span className="metric-stat__value">{latest.passRate}%</span>
              <span className="metric-stat__hint">
                优秀率(≥120) {latest.excellentRate}%
              </span>
            </div>
            <div className="metric-stat scores-metric">
              <span className="metric-stat__label">标准差</span>
              <span className="metric-stat__value">{latest.stdDev}</span>
              <span className="metric-stat__hint">
                {latest.stdDev > 13 ? "两极分化，需分层" : "分布较整齐"}
              </span>
            </div>
            <div className="metric-stat scores-metric">
              <span className="metric-stat__label">临界生(85-89)</span>
              <span className="metric-stat__value">{latest.criticalCount}</span>
              <span className="metric-stat__hint">
                {latest.criticalCount >= 5 ? "较多，优先帮扶" : "不多，顺带关照"}
              </span>
            </div>
          </div>

          {/* 四维判断条 */}
          <div className={`scores-verdict ${latest.avgTotal >= 95 ? "scores-verdict--ok" : "scores-verdict--warn"}`}>
            {latest.avgTotal >= 95 && latest.passRate >= 80 ? (
              <>
                <IconCheck size={16} />
                <span>整体稳健：均分 {latest.avgTotal}，及格率 {latest.passRate}%。保持优势，向薄弱模块要满分空间。</span>
              </>
            ) : latest.passRate < 80 ? (
              <>
                <IconAlertTriangle size={16} />
                <span>需关注：及格率 {latest.passRate}%，约 {Math.round(latest.studentCount * (1 - latest.passRate / 100))} 人未过线。抓临界生({latest.criticalCount}人)和学困生。</span>
              </>
            ) : latest.stdDev > 13 ? (
              <>
                <IconAlertTriangle size={16} />
                <span>两极分化：标准差 {latest.stdDev}，建议分层教学，好中差各定目标。</span>
              </>
            ) : (
              <>
                <IconCheck size={16} />
                <span>均分 {latest.avgTotal}，及格率 {latest.passRate}%，分布较整齐，可全班共进。</span>
              </>
            )}
          </div>

          {/* 学生画像（教师视图） */}
          <StudentPortraitPanel students={students} examName={latest?.examName} />

          <div className="overview-grid scores-grid">
            <div className="overview-stack">
              {/* 教学模块得分率 */}
              <section className="panel" data-panel>
                <div className="panel__head">
                  <div>
                    <span className="eyebrow">MODULE ANALYSIS</span>
                    <h2 className="panel__title" style={{ marginTop: 8 }}>教学模块得分率</h2>
                  </div>
                </div>
                <div className="scores-chart-area">
                  <ModuleBarChart modules={latest.moduleRates} />
                </div>
              </section>

              {/* 考试趋势 */}
              {trend.length >= 2 ? (
                <section className="panel" data-panel>
                  <div className="panel__head">
                    <div>
                      <span className="eyebrow">EXAM TREND</span>
                      <h2 className="panel__title" style={{ marginTop: 8 }}>考试趋势</h2>
                    </div>
                  </div>
                  <div className="scores-chart-area">
                    <TrendChart trend={trend} />
                  </div>
                  <div className="scores-trend-table">
                    {trend.map((t) => (
                      <div className="pipeline__row" key={t.examName}>
                        <span className="pipeline__title">{t.examName}</span>
                        <span className="pipeline__stage mono">均分 {t.avgTotal} · 及格 {t.passRate}%</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>

            <div className="overview-stack">
              {/* 位次段分布 */}
              <section className="panel" data-panel>
                <div className="panel__head">
                  <div>
                    <span className="eyebrow">SEGMENT</span>
                    <h2 className="panel__title" style={{ marginTop: 8 }}>位次段分布</h2>
                  </div>
                </div>
                <SegDistribution seg={latest.segDist} />
              </section>

              {/* 薄弱模块 */}
              <section className="panel" data-panel>
                <div className="panel__head">
                  <div>
                    <span className="eyebrow">FOCUS</span>
                    <h2 className="panel__title" style={{ marginTop: 8 }}>最该先抓的模块</h2>
                  </div>
                </div>
                <div className="pipeline">
                  {latest.weakModules.map((mod, i) => (
                    <div className="pipeline__row" key={mod.name}>
                      <span className="status-dot status-dot--warn" />
                      <span className="pipeline__title">
                        {i + 1}. {mod.name}
                      </span>
                      <span className="pipeline__stage mono" style={{ color: "#e85a4f" }}>
                        {(mod.rate * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              {/* 报表文件列表 */}
              <section className="panel" data-panel>
                <div className="panel__head">
                  <div>
                    <span className="eyebrow">REPORTS</span>
                    <h2 className="panel__title" style={{ marginTop: 8 }}>已生成报表</h2>
                  </div>
                </div>
                <div className="scores-file-list">
                  {excelFiles.map((f) => (
                    <div className="pipeline__row" key={f.fileName}>
                      <IconFileSpreadsheet size={14} stroke={1.5} style={{ opacity: 0.5 }} />
                      <span className="pipeline__title">{f.examName}</span>
                      <span className="pipeline__stage mono" style={{ fontSize: 11 }}>
                        {f.dateStr ? `${f.dateStr.slice(0, 4)}-${f.dateStr.slice(4, 6)}-${f.dateStr.slice(6, 8)}` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </>
      ) : (
        <div className="panel">
          <div className="collection-empty">暂无有效成绩数据</div>
        </div>
      )}
    </div>
  );
}
