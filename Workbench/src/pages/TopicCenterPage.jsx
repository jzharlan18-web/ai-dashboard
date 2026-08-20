import { Fragment, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  IconCircleCheck,
  IconCircleDashed,
  IconEdit,
  IconTrash,
  IconX,
  IconSparkles,
  IconRowInsertBottom,
} from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import {
  loadCollection,
  updateTopicConditions,
  finalizeTopicConditions,
  updateTopicCondition,
  promoteTopic,
} from "../lib/api";
import { formatCompactDate } from "../lib/format";

function ConditionItem({ condition, index, onToggle, onUpdateNote, onDelete, onEditText }) {
  const [expanded, setExpanded] = useState(false);
  const [noteText, setNoteText] = useState(condition.note || "");
  const [editingText, setEditingText] = useState(false);
  const [editText, setEditText] = useState(condition.condition);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNoteText(condition.note || "");
  }, [condition.note]);

  const handleToggle = async () => {
    await onToggle(index, !condition.done);
  };

  const handleSaveNote = async () => {
    setSaving(true);
    try {
      await onUpdateNote(index, noteText);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveText = async () => {
    setSaving(true);
    try {
      await onEditText(index, editText);
      setEditingText(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`condition-item${condition.done ? " condition-item--done" : ""}`}>
      <div className="condition-item__row">
        <button
          type="button"
          className="condition-item__check"
          onClick={handleToggle}
          aria-label={condition.done ? "取消完成" : "标记完成"}
        >
          {condition.done
            ? <IconCircleCheck size={20} stroke={1.8} />
            : <IconCircleDashed size={20} stroke={1.8} />}
        </button>

        {editingText ? (
          <div className="condition-item__edit-row">
            <input
              type="text"
              className="condition-item__edit-input"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveText()}
              autoFocus
            />
            <button type="button" className="condition-item__save-btn" onClick={handleSaveText} disabled={saving}>
              {saving ? "…" : "保存"}
            </button>
            <button type="button" className="condition-item__cancel-btn" onClick={() => { setEditingText(false); setEditText(condition.condition); }}>
              <IconX size={14} />
            </button>
          </div>
        ) : (
          <div className="condition-item__content" onClick={() => setExpanded(!expanded)}>
            <span className="condition-item__text">{condition.condition}</span>
            {condition.done && condition.note && (
              <span className="condition-item__note-preview">
                {condition.note.slice(0, 40)}{condition.note.length > 40 ? "…" : ""}
              </span>
            )}
          </div>
        )}

        <div className="condition-item__actions">
          {!editingText && (
            <>
              <button type="button" className="condition-item__action" onClick={() => setEditingText(true)} title="编辑条件">
                <IconEdit size={14} stroke={1.8} />
              </button>
              <button type="button" className="condition-item__action condition-item__action--danger" onClick={() => onDelete(index)} title="删除条件">
                <IconTrash size={14} stroke={1.8} />
              </button>
            </>
          )}
          <button
            type="button"
            className="condition-item__expand"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "收起" : "展开"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="condition-item__note-area">
          <textarea
            className="condition-item__note-input"
            placeholder="填写完成内容（如文件路径、成果描述等）…"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={3}
          />
          <div className="condition-item__note-actions">
            <button
              type="button"
              className={condition.done ? "condition-item__note-edit" : "condition-item__note-done"}
              onClick={handleSaveNote}
              disabled={saving}
            >
              {saving ? "保存中…" : condition.done ? "更新内容" : "保存并标记完成"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function InsertAfterDivider({ afterIndex, onInsert }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const handleInsert = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await onInsert(afterIndex, trimmed);
      setText("");
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setText("");
    setOpen(false);
  };

  if (open) {
    return (
      <div className="tc-card__insert-form-wrap">
        <div className="tc-card__insert-form">
          <input
            type="text"
            className="tc-card__add-input"
            placeholder="新条件内容…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleInsert(); }
              if (e.key === "Escape") { e.preventDefault(); handleCancel(); }
            }}
            autoFocus
          />
          <button
            type="button"
            className="tc-card__add-btn"
            onClick={handleInsert}
            disabled={saving || !text.trim()}
          >
            {saving ? "…" : "插入"}
          </button>
          <button
            type="button"
            className="tc-card__insert-cancel"
            onClick={handleCancel}
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="tc-card__insert-divider"
      onClick={() => setOpen(true)}
      title="在此条件之后插入新条件"
    >
      <span className="tc-card__insert-line" />
      <span className="tc-card__insert-label">
        <IconRowInsertBottom size={12} stroke={1.8} />
        <span>在此条件后插入新条件</span>
      </span>
      <span className="tc-card__insert-line" />
    </button>
  );
}

function TopicCard({ topic, onRefresh, onOpenDocument }) {
  const [conditions, setConditions] = useState(topic.landingConditions || []);
  const [saving, setSaving] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [deliverError, setDeliverError] = useState(null);
  const [deliveredExpanded, setDeliveredExpanded] = useState(false);
  const [reworkNote, setReworkNote] = useState("");

  const total = conditions.length;
  const done = conditions.filter((c) => c.done).length;
  const allDone = total > 0 && done === total;
  const isDelivered = topic.isFilmed || topic.isPublished || topic.productionStatus === "delivered";

  const handleSaveConditions = async (updated) => {
    setSaving(true);
    try {
      await updateTopicConditions(topic.path, updated);
      setConditions(updated);
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (index, doneVal) => {
    await updateTopicCondition(topic.path, index, { done: doneVal });
    const updated = [...conditions];
    updated[index] = { ...updated[index], done: doneVal };
    setConditions(updated);
    onRefresh();
  };

  const handleUpdateNote = async (index, note) => {
    const wasDone = conditions[index].done;
    await updateTopicCondition(topic.path, index, { note, done: true });
    const updated = [...conditions];
    updated[index] = { ...updated[index], note, done: true };
    setConditions(updated);
    onRefresh();
  };

  const handleDelete = async (index) => {
    const updated = conditions.filter((_, i) => i !== index);
    await handleSaveConditions(updated);
  };

  const handleEditText = async (index, text) => {
    const updated = [...conditions];
    updated[index] = { ...updated[index], condition: text };
    await handleSaveConditions(updated);
  };

  const handleInsertAfter = async (afterIndex, text) => {
    if (!text) return;
    const updated = [
      ...conditions.slice(0, afterIndex + 1),
      { condition: text, done: false, note: "" },
      ...conditions.slice(afterIndex + 1),
    ];
    await handleSaveConditions(updated);
  };

  const handlePromote = async () => {
    setPromoting(true);
    try {
      await promoteTopic(topic.path);
      onRefresh();
    } finally {
      setPromoting(false);
    }
  };

  const handleDeliver = async (reworkNote = "") => {
    setDelivering(true);
    setDeliverError(null);
    try {
      const encodedPath = encodeURIComponent(topic.path);
      const response = await fetch(`/api/topics/${encodedPath}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reworkNote }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message || "整合失败");
      }
      onRefresh();
    } catch (err) {
      setDeliverError(err.message || "整合失败");
    } finally {
      setDelivering(false);
    }
  };

  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <motion.div
      className={`tc-card${allDone ? " tc-card--ready" : ""}${isDelivered ? " tc-card--delivered" : ""}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="tc-card__header">
        <div className="tc-card__info">
          <div className="tc-card__title" onClick={() => onOpenDocument(topic)}>
            {topic.title}
          </div>
          <div className="tc-card__meta">
            {topic.series && <span className="tc-card__tag">{topic.series}</span>}
            {topic.contentFormat && <span className="tc-card__tag">{topic.contentFormat}</span>}
            {topic.journeyStage && <span className="tc-card__tag">{topic.journeyStage}</span>}
          </div>
        </div>
        <div className="tc-card__status">
          {isDelivered ? (
            <span className="tc-card__badge tc-card__badge--delivered">已交付</span>
          ) : allDone ? (
            <span className="tc-card__badge tc-card__badge--ready">全部完成</span>
          ) : total > 0 ? (
            <span className="tc-card__badge tc-card__badge--tracking">
              {done}/{total}
            </span>
          ) : (
            <span className="tc-card__badge tc-card__badge--draft">待补条件</span>
          )}
        </div>
      </div>

      {total > 0 && (
        <div className="tc-card__progress">
          <div className="tc-card__progress-bar">
            <div
              className="tc-card__progress-fill"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="tc-card__progress-text">
            就绪度 {progressPct}%
          </span>
        </div>
      )}

      {topic.folderStatus === "idea" ? (
        <div className="tc-card__promote">
          <p className="tc-card__promote-hint">此灵感尚未确认推进</p>
          <button
            type="button"
            className="tc-card__promote-btn"
            onClick={handlePromote}
            disabled={promoting}
          >
            {promoting ? "AI 生成条件中…" : "确认推进 → 生成落地条件"}
          </button>
        </div>
      ) : isDelivered ? (
        <div className="tc-card__delivered">
          {/* 收起态：始终显示最新成品稿入口 */}
          <div className="tc-card__delivered-summary">
            <div className="tc-card__delivered-info">
              <span className="tc-card__delivered-text">
                已交付{topic.productionVersionCount > 1 ? ` · 共 ${topic.productionVersionCount} 版` : ""}
              </span>
              {topic.productionFile && (
                <button
                  type="button"
                  className="tc-card__delivered-link"
                  onClick={() => onOpenDocument({ relativePath: topic.productionFile, title: topic.title })}
                >
                  查看最新成品稿 →
                </button>
              )}
            </div>
            <button
              type="button"
              className="tc-card__delivered-toggle"
              onClick={() => setDeliveredExpanded(!deliveredExpanded)}
            >
              {deliveredExpanded ? "收起 ▴" : "展开 ▾"}
            </button>
          </div>

          {deliveredExpanded && (
            <div className="tc-card__delivered-detail">
              {/* 版本历史 */}
              {topic.productionHistory && topic.productionHistory.length > 0 && (
                <div className="tc-card__versions">
                  <div className="tc-card__versions-title">成品稿版本</div>
                  <div className="tc-card__versions-list">
                    {[...topic.productionHistory].reverse().map((entry, i) => (
                      <div key={i} className="tc-card__version-item">
                        <span className="tc-card__version-badge">
                          v{entry.version ?? "?"}
                        </span>
                        <span className="tc-card__version-date">
                          {entry.generated_at || "—"}
                        </span>
                        {entry.rework_note && (
                          <span className="tc-card__version-note" title={entry.rework_note}>
                            {entry.rework_note.length > 40
                              ? `${entry.rework_note.slice(0, 40)}…`
                              : entry.rework_note}
                          </span>
                        )}
                        {entry.file && (
                          <button
                            type="button"
                            className="tc-card__version-link"
                            onClick={() => onOpenDocument({ relativePath: entry.file, title: `${topic.title} v${entry.version}` })}
                          >
                            查看
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 落地条件（可编辑） */}
              <div className="tc-card__conditions-header">
                <span className="tc-card__conditions-title">落地条件</span>
                <span className="tc-card__conditions-hint">交付后仍可修改</span>
              </div>

              <div className="tc-card__condition-list">
                {conditions.map((c, i) => (
                  <Fragment key={i}>
                    <ConditionItem
                      condition={c}
                      index={i}
                      onToggle={handleToggle}
                      onUpdateNote={handleUpdateNote}
                      onDelete={handleDelete}
                      onEditText={handleEditText}
                    />
                    <InsertAfterDivider
                      afterIndex={i}
                      onInsert={handleInsertAfter}
                    />
                  </Fragment>
                ))}
              </div>

              {/* 重新交付区 */}
              <div className="tc-card__redeliver-section">
                {deliverError && (
                  <p className="tc-card__deliver-error">{deliverError}</p>
                )}
                <div className="tc-card__redeliver-input-wrap">
                  <textarea
                    className="tc-card__redeliver-input"
                    placeholder="本次重新交付要规避的问题（可选，留空则直接重新整合）…"
                    value={reworkNote}
                    onChange={(e) => setReworkNote(e.target.value)}
                    rows={2}
                  />
                </div>
                <button
                  type="button"
                  className="tc-card__redeliver-btn"
                  onClick={() => handleDeliver(reworkNote.trim())}
                  disabled={delivering}
                >
                  {delivering ? (
                    <>
                      <IconSparkles size={16} />
                      Codex 重新整合中…
                    </>
                  ) : (
                    <>
                      <IconSparkles size={16} />
                      重新整合成品稿
                    </>
                  )}
                </button>
                <p className="tc-card__deliver-hint">
                  修改条件或填写规避问题后重新整合，旧版本会保留在版本历史中。
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="tc-card__conditions">
          <div className="tc-card__conditions-header">
            <span className="tc-card__conditions-title">落地条件</span>
          </div>

          <div className="tc-card__condition-list">
            {conditions.map((c, i) => (
              <Fragment key={i}>
                <ConditionItem
                  condition={c}
                  index={i}
                  onToggle={handleToggle}
                  onUpdateNote={handleUpdateNote}
                  onDelete={handleDelete}
                  onEditText={handleEditText}
                />
                <InsertAfterDivider
                  afterIndex={i}
                  onInsert={handleInsertAfter}
                />
              </Fragment>
            ))}
          </div>

          {allDone && (
            <div className="tc-card__deliver-section">
              {deliverError && (
                <p className="tc-card__deliver-error">{deliverError}</p>
              )}
              <button
                type="button"
                className="tc-card__deliver-btn"
                onClick={handleDeliver}
                disabled={delivering}
              >
                {delivering ? (
                  <>
                    <IconSparkles size={16} />
                    Codex 整合成品中…
                  </>
                ) : (
                  <>
                    <IconSparkles size={16} />
                    定稿确认 → AI 整合成品稿
                  </>
                )}
              </button>
              <p className="tc-card__deliver-hint">
                所有条件已完成，点击后 Codex 将整合灵感原文 + 条件内容，生成可交付的{topic.contentFormat || "成品稿"}
              </p>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

export function TopicCenterPage({ onOpenDocument }) {
  const [result, setResult] = useState({ data: null, source: "loading", error: null });
  const [filter, setFilter] = useState("active");

  const refresh = () => {
    loadCollection("content").then((response) => {
      setResult(response);
    });
  };

  useEffect(() => { refresh(); }, []);

  const allItems = result.data?.items ?? [];

  const ideaTopics = useMemo(
    () => allItems.filter((t) => t.folderStatus === "idea"),
    [allItems],
  );
  const selectedTopics = useMemo(
    () => allItems.filter((t) => t.folderStatus === "selected"),
    [allItems],
  );
  const publishedTopics = useMemo(
    () => allItems.filter((t) => t.isPublished || t.isFilmed || t.productionStatus === "delivered"),
    [allItems],
  );
  const trackingTopics = useMemo(
    () => selectedTopics.filter((t) => !(t.isPublished || t.isFilmed || t.productionStatus === "delivered")),
    [selectedTopics],
  );

  const filteredTopics = useMemo(() => {
    switch (filter) {
      case "ideas": return ideaTopics;
      case "tracking": return trackingTopics;
      case "done": return publishedTopics;
      default: return trackingTopics;
    }
  }, [filter, ideaTopics, trackingTopics, publishedTopics]);

  const isLoading = result.source === "loading";
  const hasError = result.error && !result.data;

  const counts = {
    active: trackingTopics.length,
    ideas: ideaTopics.length,
    tracking: trackingTopics.length,
    done: publishedTopics.length,
  };

  return (
    <div className="page page--topic-center">
      <PageHeader
        eyebrow="TOPIC LANDING"
        title="选题中心"
        description="已确认选题的落地条件追踪。逐条补足条件，全部完成后 AI 整合为可交付成品。"
        aside={
          <div className="collection-count">
            {isLoading ? "…" : `${counts.active} 追踪中`}
          </div>
        }
      />

      <div className="topic-center-filters">
        {[
          ["active", "追踪中"],
          ["done", "已交付"],
          ["ideas", "待确认灵感"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`topic-center-filter${filter === key ? " topic-center-filter--on" : ""}`}
            onClick={() => setFilter(key)}
          >
            {label}
            <span className="topic-center-filter__count">{counts[key]}</span>
          </button>
        ))}
      </div>

      {isLoading && (
        <div>
          <div className="skeleton" style={{ height: "200px", marginBottom: "12px" }} />
          <div className="skeleton" style={{ height: "200px", marginBottom: "12px" }} />
        </div>
      )}

      {hasError && (
        <div className="error-note">
          加载失败：{result.error?.message || "未知错误"}
        </div>
      )}

      {!isLoading && !hasError && (
        <>
          {filteredTopics.length > 0 ? (
            <div className="topic-center-list">
              {filteredTopics.map((topic) => (
                <TopicCard
                  key={topic.id}
                  topic={topic}
                  onRefresh={refresh}
                  onOpenDocument={onOpenDocument}
                />
              ))}
            </div>
          ) : (
            <div className="collection-empty">
              {filter === "ideas"
                ? "灵感库中的想法确认推进后会出现在这里"
                : "暂无追踪中的选题"}
            </div>
          )}
        </>
      )}
    </div>
  );
}
