import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, assetUrl } from "../api/client";
import type { Mistake, PracticeSession, Reason } from "../api/types";
import { Icon } from "../components/Icon";
import { Button, Empty, IconButton, InlineNav, MasteryChip, Sheet, Spinner, SubjectChip } from "../components/ui";
import { RATING_LABEL, REASONS, REASON_LABEL, formatDate, relativeDue } from "../lib/format";
import { haptic } from "../lib/native";
import { useAsync } from "../lib/useAsync";
import { useBanner, toast, toastError } from "../store/banner";

export default function Detail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const show = useBanner((s) => s.show);
  const { data, loading, error, reload, setData } = useAsync(() => api<{ mistake: Mistake }>(`/api/mistakes/${id}`), [id]);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [edit, setEdit] = useState(false);
  const [confirmMaster, setConfirmMaster] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ stemText: string; studentAnswer: string; correctAnswer: string; analysis: string; reasons: Reason[]; note: string } | null>(null);

  const m = data?.mistake;
  const set = (mistake: Mistake) => setData({ mistake });

  const master = async () => {
    if (!m) return;
    setBusy(true);
    try {
      const res = await api<{ mistake: Mistake }>(`/api/mistakes/${m.id}/master`, { method: "POST" });
      set(res.mistake);
      setConfirmMaster(false);
      void haptic.success();
      show("已标记为已掌握，不再进入复习计划", {
        kind: "success",
        action: { label: "撤销", onClick: () => void reinstate() },
      });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const reinstate = async () => {
    if (!m) return;
    try {
      const res = await api<{ mistake: Mistake }>(`/api/mistakes/${m.id}/reinstate`, { method: "POST" });
      set(res.mistake);
      toast("已重新加入复习");
    } catch (e) {
      toastError(e);
    }
  };

  const remove = async () => {
    if (!m) return;
    setBusy(true);
    try {
      await api(`/api/mistakes/${m.id}`, { method: "DELETE" });
      toast("已删除", "success");
      nav(-1);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const practice = async () => {
    if (!m) return;
    setBusy(true);
    try {
      const res = await api<{ session: PracticeSession }>("/api/practice/start", {
        method: "POST",
        body: { mode: "weak", topic: m.knowledgePoints[0], subject: m.subject, count: 3 },
      });
      nav(`/practice/quiz/${res.session.id}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!m || !draft) return;
    if (!draft.stemText.trim()) return toast("题目不能为空", "error");
    if (draft.reasons.length === 0) return toast("请至少选一个错因", "error");
    setBusy(true);
    try {
      const res = await api<{ mistake: Mistake }>(`/api/mistakes/${m.id}`, { method: "PATCH", body: draft });
      set(res.mistake);
      setEdit(false);
      toast("已保存", "success");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const openEdit = () => {
    if (!m) return;
    setDraft({ stemText: m.stemText, studentAnswer: m.studentAnswer, correctAnswer: m.correctAnswer ?? "", analysis: m.analysis ?? "", reasons: m.reasons, note: m.note });
    setMenu(false);
    setEdit(true);
  };

  const historyColor: Record<string, string> = { new: "var(--wrong)", again: "var(--wrong)", forgot: "var(--wrong)", fuzzy: "var(--due)", remembered: "var(--mastered)", correct: "var(--mastered)", wrong: "var(--wrong)", manual: "var(--mastered)", reinstated: "var(--learning)" };
  const historyText = (h: { kind: string; result: string }) => {
    if (h.kind === "create") return h.result === "again" ? "再次录入（又错了一次）" : "录入";
    if (h.kind === "review") return `复习 · ${RATING_LABEL[h.result as keyof typeof RATING_LABEL] ?? h.result}`;
    if (h.kind === "practice") return `练习 · ${h.result === "correct" ? "答对" : "答错"}`;
    if (h.kind === "master") return h.result === "manual" ? "手动标记已掌握" : "重新加入复习";
    return h.result;
  };

  return (
    <div className="screen">
      <InlineNav
        title="错题详情"
        back
        backLabel={m?.knowledgePoints[0] ?? "错题库"}
        right={<IconButton name="ellipsis" label="更多操作" onClick={() => setMenu(true)} />}
      />
      <div className="screen__content screen__content--modal" style={{ gap: 10, paddingBottom: 0 }}>
        {loading && !m && <Spinner />}
        {error && !m && <Empty icon="warning" title="加载失败" text={error.message} action={<Button size="sm" variant="tinted" onClick={() => reload()}>重试</Button>} />}
        {m && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 0 2px" }}>
              <div style={{ display: "flex", gap: 8 }}>
                <SubjectChip subject={m.subject} />
                <MasteryChip mastery={m.mastery} />
              </div>
              <h2 className="t-title2">{m.knowledgePoints.join(" · ") || "未分类"}</h2>
              <span className="t-foot c-sec">
                {formatDate(m.createdAt)}
                {m.source?.name ? ` · ${m.source.name}` : ""}
                {m.wrongCount > 1 ? ` · 错过 ${m.wrongCount} 次` : ""}
              </span>
            </div>

            {m.stemImageUrl && (
              <button className="card row" style={{ flexDirection: "row", padding: "10px 12px", gap: 12 }} onClick={() => setImageOpen(true)}>
                <img src={assetUrl(m.stemImageUrl)} alt="原题截图" style={{ width: 64, height: 44, objectFit: "cover", borderRadius: 8, border: "1px solid var(--separator)" }} />
                <span className="row__main"><span className="t-sub">原题截图</span></span>
                <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
              </button>
            )}

            <div className="card" style={{ gap: 8 }}>
              <span className="t-foot c-sec" style={{ fontWeight: 600 }}>题目</span>
              <p className="t-body" style={{ whiteSpace: "pre-wrap" }}>{m.stemText}</p>
              {m.questionType === "choice" && m.options.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {m.options.map((o, i) => (
                    <span key={i} className="t-sub">{String.fromCharCode(65 + i)}. {o}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="card" style={{ gap: 8 }}>
              <span className="t-foot c-sec" style={{ fontWeight: 600 }}>我当时的答案</span>
              <p className="t-sub" style={{ color: "var(--wrong)", whiteSpace: "pre-wrap" }}>{m.studentAnswer || "（未记录）"}</p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {m.reasons.map((r) => (
                  <span key={r} className="chip" style={{ background: "var(--fill-light)", color: "var(--label)" }}>{REASON_LABEL[r]}</span>
                ))}
                {m.note && <span className="t-foot c-sec">{m.note}</span>}
              </div>
            </div>

            <div className="card" style={{ border: "1.5px solid var(--brand)", gap: 8 }}>
              <button style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", minHeight: 36, textAlign: "left" }} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
                <span className="t-headline">{open ? "正确答案与解析" : "先想一想，再看答案"}</span>
                <Icon name={open ? "chevron-up" : "chevron-down"} size={18} stroke={2.2} style={{ color: "var(--tertiary)" }} />
              </button>
              {open && (
                <>
                  <p className="t-body" style={{ fontWeight: 700 }}>{m.correctAnswer || "（暂无答案）"}</p>
                  {m.analysis && <p className="t-sub" style={{ color: "var(--secondary)", whiteSpace: "pre-wrap" }}>{m.analysis}</p>}
                  {m.tip && <p className="t-sub" style={{ color: "var(--brand-on-tint)", background: "var(--brand-tint)", borderRadius: 10, padding: "8px 10px" }}>{m.tip}</p>}
                  {m.aiGenerated && <span className="t-cap c-sec">解析由 AI 生成，请结合课堂讲解核对</span>}
                </>
              )}
            </div>

            <div className="card" style={{ gap: 8 }}>
              <span className="t-foot c-sec" style={{ fontWeight: 600 }}>复习记录</span>
              {(m.history ?? []).map((h, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }} className="t-foot">
                  <span style={{ width: 10, height: 10, borderRadius: 5, background: historyColor[h.result] ?? "var(--tertiary)", flexShrink: 0 }} />
                  <span>{formatDate(h.at)} {historyText(h)}</span>
                </div>
              ))}
              {m.mastery !== "mastered" && m.review.nextDueAt && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }} className="t-foot">
                  <span style={{ width: 10, height: 10, borderRadius: 5, background: "var(--due)", flexShrink: 0 }} />
                  <span style={{ color: "var(--due)", fontWeight: 600 }}>
                    {m.mastery === "due" ? "今天要复习" : `${relativeDue(m.review.nextDueAt)}复习`}
                    {m.review.streak === 1 && m.review.intervalIndex >= 1 ? " · 再答对 1 次即掌握" : ""}
                  </span>
                </div>
              )}
              {m.mastery === "mastered" && (
                <span className="t-foot" style={{ color: "var(--mastered)", fontWeight: 600 }}>
                  {formatDate(m.masteredAt)} 已掌握{m.manualMastered ? "（手动标记）" : ""} · 30 天后保温复习一次
                </span>
              )}
            </div>

            <div className="bottom-bar">
              {m.mastery === "mastered" ? (
                <Button variant="tinted" onClick={reinstate} style={{ flex: 1 }}>重新加入复习</Button>
              ) : (
                <Button variant="tinted" onClick={() => setConfirmMaster(true)} style={{ flex: 1 }}>标记已掌握</Button>
              )}
              <Button onClick={practice} disabled={busy} style={{ flex: 1 }}>练同类题</Button>
            </div>
          </>
        )}
      </div>

      <Sheet open={menu} onClose={() => setMenu(false)}>
        <button className="row" style={{ borderRadius: 10 }} onClick={openEdit}><Icon name="pencil" /><span className="row__main"><span className="row__title">编辑题目与错因</span></span></button>
        <button className="row" style={{ borderRadius: 10 }} onClick={() => { setMenu(false); toast("导出 PDF 将在下个版本提供"); }}><Icon name="export" /><span className="row__main"><span className="row__title">导出 PDF</span></span></button>
        <button className="row" style={{ borderRadius: 10, color: "var(--wrong)" }} onClick={() => { setMenu(false); setConfirmDelete(true); }}><Icon name="trash" /><span className="row__main"><span className="row__title">删除这道错题</span></span></button>
      </Sheet>

      <Sheet open={confirmMaster} onClose={() => setConfirmMaster(false)} title="标记为已掌握？">
        <p className="t-sub c-sec">这道题不再进入复习计划，30 天后会安排一次保温复习。7 天内可以在这里撤销。</p>
        <Button onClick={master} disabled={busy}>标记已掌握</Button>
        <Button variant="plain" onClick={() => setConfirmMaster(false)}>取消</Button>
      </Sheet>

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="删除这道错题？">
        <p className="t-sub c-sec">原题截图和复习记录会一起删除，无法恢复。</p>
        <Button variant="danger" onClick={remove} disabled={busy}>删除</Button>
        <Button variant="plain" onClick={() => setConfirmDelete(false)}>取消</Button>
      </Sheet>

      <Sheet open={edit} onClose={() => setEdit(false)} title="编辑">
        {draft && (
          <>
            <label className="t-foot c-sec" style={{ fontWeight: 600 }}>题目</label>
            <textarea className="input" rows={3} value={draft.stemText} onChange={(e) => setDraft({ ...draft, stemText: e.target.value })} />
            <label className="t-foot c-sec" style={{ fontWeight: 600 }}>我当时的答案</label>
            <input className="input" value={draft.studentAnswer} onChange={(e) => setDraft({ ...draft, studentAnswer: e.target.value })} />
            <label className="t-foot c-sec" style={{ fontWeight: 600 }}>正确答案</label>
            <input className="input" value={draft.correctAnswer} onChange={(e) => setDraft({ ...draft, correctAnswer: e.target.value })} />
            <label className="t-foot c-sec" style={{ fontWeight: 600 }}>解析</label>
            <textarea className="input" rows={3} value={draft.analysis} onChange={(e) => setDraft({ ...draft, analysis: e.target.value })} />
            <label className="t-foot c-sec" style={{ fontWeight: 600 }}>错因</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {REASONS.map((r) => (
                <button key={r} className={`chip chip--select${draft.reasons.includes(r) ? " on" : ""}`} aria-pressed={draft.reasons.includes(r)} onClick={() => setDraft({ ...draft, reasons: draft.reasons.includes(r) ? draft.reasons.filter((x) => x !== r) : [...draft.reasons, r] })}>
                  {REASON_LABEL[r]}
                </button>
              ))}
            </div>
            <input className="input" placeholder="补充说明" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            <Button onClick={saveEdit} disabled={busy}>保存</Button>
          </>
        )}
      </Sheet>

      {imageOpen && m?.stemImageUrl && (
        <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 60, display: "flex", flexDirection: "column" }} role="dialog" aria-label="原题截图">
          <div style={{ padding: "calc(var(--safe-top) + 8px) 16px 8px", display: "flex", justifyContent: "flex-end" }}>
            <button className="nav-btn" style={{ color: "#fff" }} onClick={() => setImageOpen(false)}>完成</button>
          </div>
          <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
            <img src={assetUrl(m.stemImageUrl)} alt="原题截图" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", background: "#fff" }} />
          </div>
        </div>
      )}
    </div>
  );
}
