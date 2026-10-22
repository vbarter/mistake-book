import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { Mistake, Reason, RecognizedItem, Subject } from "../../api/types";
import { Icon } from "../../components/Icon";
import { Button, InlineNav, Sheet } from "../../components/ui";
import { QTYPE_LABEL, REASONS, REASON_LABEL, SUBJECTS, SUBJECT_LABEL, subjectStyle } from "../../lib/format";
import { haptic } from "../../lib/native";
import { useBanner, toast, toastError } from "../../store/banner";
import { useCapture } from "../../store/capture";

interface SaveResponse {
  created: Mistake[];
  merged: Mistake[];
  topics: string[];
}

/** 录题第 2 步：逐题核对，保存入库。 */
export default function Recognize() {
  const nav = useNavigate();
  const { items, updateItem, removeItem, reset, returnTo } = useCapture();
  const [idx, setIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState<Record<number, boolean>>({});
  const [subjectSheet, setSubjectSheet] = useState(false);
  const [kpSheet, setKpSheet] = useState(false);
  const [newKp, setNewKp] = useState("");
  const [imageOpen, setImageOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const show = useBanner((s) => s.show);
  const leaving = useRef(false);

  useEffect(() => {
    if (items.length === 0 && !leaving.current) nav("/capture", { replace: true });
  }, [items.length, nav]);

  const leaveTo = (path: string) => {
    leaving.current = true;
    nav(path, { replace: true });
    reset();
  };

  const item = items[idx];
  if (!item) return null;
  const isLast = idx === items.length - 1;

  const toggleReason = (r: Reason) => {
    const reasons = item.reasons.includes(r) ? item.reasons.filter((x) => x !== r) : [...item.reasons, r];
    updateItem(idx, { reasons });
    void haptic.selection();
  };

  const validate = (list: RecognizedItem[]) => {
    for (let i = 0; i < list.length; i++) {
      if (!list[i].stemText.trim()) { toast(`第 ${i + 1} 题的题目不能为空`, "error"); return false; }
      if (list[i].reasons.length === 0) { toast(`第 ${i + 1} 题还没选错因`, "error"); return false; }
    }
    return true;
  };

  const payload = (it: RecognizedItem) => ({
    subject: it.subject,
    knowledgePoints: it.knowledgePoints,
    questionType: it.questionType,
    options: it.options,
    stemText: it.stemText,
    stemImage: it.stemImage,
    uncertainSpans: it.uncertainSpans,
    studentAnswer: it.studentAnswer,
    correctAnswer: it.correctAnswer,
    analysis: it.analysis,
    tip: it.tip,
    aiGenerated: it.aiGenerated,
    reasons: it.reasons,
    note: it.note,
    source: { date: new Date().toISOString().slice(0, 10) },
  });

  const finish = (res: SaveResponse) => {
    const n = res.created.length + res.merged.length;
    const topics = res.topics.slice(0, 2).join("、");
    void haptic.success();
    leaveTo(returnTo);
    show(`已归入错题库 · ${topics}${res.topics.length > 2 ? ` 等 ${res.topics.length} 个知识点` : ""}${res.merged.length ? `（${res.merged.length} 题与已有错题合并）` : ""}`, {
      kind: "success",
      action: { label: "查看", onClick: () => nav("/library") },
      duration: n > 0 ? 4000 : 2500,
    });
  };

  const saveAll = async () => {
    if (!validate(items)) return;
    setBusy(true);
    try {
      const res = await api<SaveResponse>("/api/mistakes", { method: "POST", body: { items: items.map(payload) } });
      finish(res);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const saveOne = async () => {
    if (!validate([item])) return;
    setBusy(true);
    try {
      const res = await api<SaveResponse>("/api/mistakes", { method: "POST", body: { items: [payload(item)] } });
      if (items.length === 1) {
        finish(res);
        return;
      }
      toast(res.merged.length ? "已与已有错题合并" : "已保存这题", "success");
      removeItem(idx);
      setIdx((i) => Math.min(i, items.length - 2));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const stemWithMarks = () => {
    const spans = item.uncertainSpans.filter(Boolean);
    if (spans.length === 0) return null;
    return (
      <span className="t-foot" style={{ color: "var(--due)", fontWeight: 500 }}>
        {spans.length} 处不确定：{spans.join("、")}
      </span>
    );
  };

  return (
    <div className="screen">
      <InlineNav
        title="核对错题"
        subtitle="第 2 步，共 2 步"
        back
        backLabel="试卷"
        right={<button className="nav-btn" onClick={() => setConfirmLeave(true)}>取消</button>}
      />
      <div style={{ padding: "4px 16px 8px" }}>
        <div className="seg" role="tablist">
          {items.map((it, i) => (
            <button key={i} role="tab" aria-selected={i === idx} className={`seg__item${i === idx ? " on" : ""}`} onClick={() => setIdx(i)}>
              {it.reasons.length > 0 && it.stemText.trim() ? "✓ " : ""}第 {i + 1} 题
            </button>
          ))}
        </div>
      </div>
      <div className="screen__content screen__content--modal" style={{ gap: 10, paddingBottom: 0 }}>
        <div className="card" style={{ gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="chip" style={subjectStyle(item.subject)} onClick={() => setSubjectSheet(true)} aria-label={`学科 ${SUBJECT_LABEL[item.subject]}，点按修改`}>
              {SUBJECT_LABEL[item.subject]}
              <Icon name="chevron-down" size={12} stroke={2.4} />
            </button>
            <span className="t-foot c-sec">{QTYPE_LABEL[item.questionType]}{item.reason ? ` · ${item.reason}` : " · 学科由 AI 判断，点按可改"}</span>
          </div>
          <button className="row" style={{ padding: "8px 10px", background: "var(--fill-light)", borderRadius: 10, minHeight: 56 }} onClick={() => setImageOpen(true)}>
            <img src={item.stemImage} alt="原题截图" style={{ width: 48, height: 36, objectFit: "cover", borderRadius: 6 }} />
            <span className="row__main"><span className="t-foot c-sec">原题截图 · 点按放大对照</span></span>
            <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
          </button>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <label htmlFor="stem" className="t-foot c-sec" style={{ fontWeight: 600 }}>题目（可直接修改）</label>
            {stemWithMarks()}
          </div>
          <textarea id="stem" className="input" rows={3} value={item.stemText} onChange={(e) => updateItem(idx, { stemText: e.target.value })} />
          {item.questionType === "choice" && item.options.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {item.options.map((o, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="option__letter">{String.fromCharCode(65 + i)}</span>
                  <input className="input" style={{ minHeight: 40, padding: "8px 10px" }} value={o} onChange={(e) => updateItem(idx, { options: item.options.map((x, j) => (j === i ? e.target.value : x)) })} />
                </div>
              ))}
            </div>
          )}
          <label htmlFor="student" className="t-foot c-sec" style={{ fontWeight: 600 }}>我当时的答案</label>
          <input id="student" className="input" style={{ color: "var(--wrong)" }} placeholder="没识别到作答，点此补充" value={item.studentAnswer} onChange={(e) => updateItem(idx, { studentAnswer: e.target.value })} />
        </div>

        <div className="card" style={{ gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="t-foot c-sec" style={{ fontWeight: 600 }}>知识点</span>
            <button className="t-foot" style={{ color: "var(--brand)", fontWeight: 500, minHeight: 32, padding: "0 4px" }} onClick={() => setKpSheet(true)}>添加</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {item.knowledgePoints.map((kp) => (
              <button key={kp} className="chip chip--select on" aria-label={`知识点 ${kp}，点按移除`} onClick={() => updateItem(idx, { knowledgePoints: item.knowledgePoints.filter((x) => x !== kp) })}>
                {kp}
                <Icon name="xmark" size={12} stroke={2.4} />
              </button>
            ))}
            {item.knowledgePoints.length === 0 && <span className="t-sub c-sec">还没有知识点，点「添加」</span>}
          </div>
        </div>

        <div className="card" style={{ gap: 8 }}>
          <span className="t-foot c-sec" style={{ fontWeight: 600 }}>为什么错了（可多选）</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {REASONS.map((r) => (
              <button key={r} className={`chip chip--select${item.reasons.includes(r) ? " on" : ""}`} aria-pressed={item.reasons.includes(r)} onClick={() => toggleReason(r)}>
                {REASON_LABEL[r]}
              </button>
            ))}
          </div>
          <input className="input" placeholder="补充一句：当时是怎么想的？" value={item.note} maxLength={200} onChange={(e) => updateItem(idx, { note: e.target.value })} />
        </div>

        <div className="card" style={{ gap: 8 }}>
          <button style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", minHeight: 44, textAlign: "left" }} onClick={() => setShowAnswer((s) => ({ ...s, [idx]: !s[idx] }))} aria-expanded={Boolean(showAnswer[idx])}>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Icon name="sparkles" size={22} style={{ color: "var(--brand)" }} />
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span className="t-headline">先想一想，再看答案</span>
                <span className="t-foot c-sec">AI 答案与解析已生成</span>
              </span>
            </span>
            <Icon name={showAnswer[idx] ? "chevron-up" : "chevron-down"} size={18} stroke={2.2} style={{ color: "var(--tertiary)" }} />
          </button>
          {showAnswer[idx] && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--separator-light)", paddingTop: 10 }}>
              <label htmlFor="answer" className="t-foot c-sec" style={{ fontWeight: 600 }}>正确答案</label>
              <input id="answer" className="input" value={item.correctAnswer} onChange={(e) => updateItem(idx, { correctAnswer: e.target.value, aiGenerated: false })} />
              <label htmlFor="analysis" className="t-foot c-sec" style={{ fontWeight: 600 }}>解析</label>
              <textarea id="analysis" className="input" rows={4} value={item.analysis} onChange={(e) => updateItem(idx, { analysis: e.target.value, aiGenerated: false })} />
              {item.tip && <p className="t-sub" style={{ color: "var(--brand-on-tint)", background: "var(--brand-tint)", borderRadius: 10, padding: "8px 10px" }}>{item.tip}</p>}
              <span className="t-cap c-sec">解析由 AI 生成，请结合课堂讲解核对</span>
            </div>
          )}
        </div>

        <div className="bottom-bar">
          <Button variant="tinted" onClick={saveOne} disabled={busy} style={{ width: 120 }}>保存本题</Button>
          {isLast ? (
            <Button onClick={saveAll} disabled={busy} style={{ flex: 1 }}>{busy ? "保存中…" : `保存 ${items.length} 道错题`}</Button>
          ) : (
            <Button onClick={() => setIdx((i) => i + 1)} style={{ flex: 1 }}>下一题</Button>
          )}
        </div>
      </div>

      <Sheet open={subjectSheet} onClose={() => setSubjectSheet(false)} title="选择学科">
        {SUBJECTS.map((s: Subject) => (
          <button key={s} className="row" style={{ borderRadius: 10 }} onClick={() => { updateItem(idx, { subject: s }); setSubjectSheet(false); }}>
            <span className="chip" style={subjectStyle(s)}>{SUBJECT_LABEL[s]}</span>
            <span className="row__main" />
            {item.subject === s && <Icon name="check" size={20} stroke={2.4} style={{ color: "var(--brand)" }} />}
          </button>
        ))}
      </Sheet>

      <Sheet open={kpSheet} onClose={() => setKpSheet(false)} title="添加知识点">
        <input className="input" autoFocus placeholder="例如：分数乘法" value={newKp} onChange={(e) => setNewKp(e.target.value)} />
        <Button
          onClick={() => {
            const kp = newKp.trim();
            if (kp && !item.knowledgePoints.includes(kp)) updateItem(idx, { knowledgePoints: [...item.knowledgePoints, kp].slice(0, 3) });
            setNewKp("");
            setKpSheet(false);
          }}
          disabled={!newKp.trim()}
        >
          添加
        </Button>
      </Sheet>

      {imageOpen && (
        <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 60, display: "flex", flexDirection: "column" }} role="dialog" aria-label="原题截图">
          <div style={{ padding: "calc(var(--safe-top) + 8px) 16px 8px", display: "flex", justifyContent: "flex-end" }}>
            <button className="nav-btn" style={{ color: "#fff" }} onClick={() => setImageOpen(false)}>完成</button>
          </div>
          <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
            <img src={item.stemImage} alt="原题截图" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          </div>
        </div>
      )}

      <Sheet open={confirmLeave} onClose={() => setConfirmLeave(false)} title={`丢弃 ${items.length} 道题？`}>
        <p className="t-sub c-sec">识别结果不会保存。</p>
        <Button variant="danger" onClick={() => leaveTo(returnTo)}>丢弃</Button>
        <Button variant="plain" onClick={() => setConfirmLeave(false)}>继续核对</Button>
      </Sheet>
    </div>
  );
}
