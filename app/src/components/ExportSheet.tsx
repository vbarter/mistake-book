import { useState } from "react";
import { apiBlob } from "../api/client";
import { toBookItems, type ErrorItem } from "../lib/errors";
import { validDigitized, type Paper } from "../lib/folders";
import { exportPdf, haptic } from "../lib/native";
import { toast, toastError } from "../store/banner";
import { Icon } from "./Icon";
import { Button, Sheet } from "./ui";
import { Tag } from "./v2";

type Scope = "all" | "open";

/**
 * 导出面板：两种文件。
 * 错题本 = 横向打印，左半页空白重做、右半页错题修正；原始电子试卷 = 干净原卷 + 作答对照表。
 * errors 是本次范围内的错题；papers 是本次范围内已扫描的试卷（错题库导出时不传，只出错题本）。
 */
export function ExportSheet({ open, onClose, title, subtitle, errors, papers }: { open: boolean; onClose: () => void; title: string; subtitle?: string; errors: ErrorItem[]; papers?: Paper[] }) {
  const [kind, setKind] = useState<"book" | "paper">("book");
  const [scope, setScope] = useState<Scope>("all");
  const [busy, setBusy] = useState(false);
  const openErrors = errors.filter((e) => !e.corrected);
  const chosen = scope === "all" ? errors : openErrors;
  const scanned = (papers ?? []).filter((p) => validDigitized(p.digitized));
  const bookPages = Math.max(1, Math.ceil(toBookItems(chosen).length / 3));

  const run = async () => {
    setBusy(true);
    try {
      if (kind === "book") {
        const items = toBookItems(chosen);
        if (items.length === 0) return toast("这个范围里没有错题");
        const blob = await apiBlob("/api/digitize/book", { method: "POST", body: { title: `${title} 错题本`, subtitle: [subtitle, `${chosen.length} 题`, scope === "open" ? "只含未订正" : ""].filter(Boolean).join(" · "), items }, timeoutMs: 90000 });
        await exportPdf(blob, `${title} 错题本.pdf`);
      } else {
        if (scanned.length === 0) return toast("还没有扫描过的试卷");
        const body = { title, papers: scanned.map((p) => { const d = validDigitized(p.digitized)!; return { title: `${title} · ${p.name}`, pages: d.pages, questions: d.questions }; }) };
        const blob = await apiBlob("/api/digitize/pdf", { method: "POST", body, timeoutMs: 90000 });
        await exportPdf(blob, `${title} 电子试卷.pdf`);
      }
      void haptic.success();
      onClose();
    } catch (e) {
      if (!/cancel/i.test(String((e as Error).message))) toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 2px" }}>
        <span className="tile tile--sm" style={{ background: "var(--brand-tint)", color: "var(--brand)" }}><Icon name="export" size={20} stroke={2.2} /></span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <h2 className="t-title3 ellipsis" style={{ fontWeight: 800 }}>导出「{title}」</h2>
          <span className="t-foot c-sec">生成 PDF 后可以直接打印、存到「文件」或发给老师</span>
        </div>
      </div>

      <button className="card card--row" style={{ border: kind === "book" ? "2px solid var(--brand)" : "2px solid transparent", boxShadow: kind === "book" ? "0 6px 16px rgba(47,111,237,.14)" : "none" }} onClick={() => setKind("book")} aria-pressed={kind === "book"}>
        <svg aria-hidden="true" width="64" height="50" viewBox="0 0 72 56" fill="none" style={{ flexShrink: 0 }}>
          <rect x="2" y="2" width="68" height="52" rx="6" fill="var(--card)" stroke="var(--brand)" strokeWidth="2" />
          <path d="M36 2v52" stroke="var(--brand)" strokeWidth="2" strokeDasharray="3 3" />
          <path d="M10 14h18M10 22h18M10 30h12" stroke="var(--label)" strokeWidth="2" strokeLinecap="round" />
          <path d="M44 14h16" stroke="var(--wrong)" strokeWidth="2" strokeLinecap="round" />
          <path d="M44 22h12" stroke="var(--mastered)" strokeWidth="2" strokeLinecap="round" />
          <path d="M44 30h18M44 38h14" stroke="var(--separator)" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span className="t-headline" style={{ display: "flex", alignItems: "center", gap: 6 }}>错题本 <Tag kind="accent" icon="sparkles">推荐</Tag></span>
          <span className="t-foot c-sec">横向打印。左边空白重做，右边错题修正，对折就能自测。</span>
          <span className="t-cap c-sec">{chosen.length} 题 · 约 {bookPages} 页</span>
        </span>
        <Icon name={kind === "book" ? "checkcircle" : "chevron-right"} size={22} style={{ color: kind === "book" ? "var(--brand)" : "var(--tertiary)" }} />
      </button>

      {papers && (
        <button className="card card--row" style={{ border: kind === "paper" ? "2px solid var(--brand)" : "2px solid transparent" }} onClick={() => setKind("paper")} aria-pressed={kind === "paper"}>
          <svg aria-hidden="true" width="64" height="50" viewBox="0 0 72 56" fill="none" style={{ flexShrink: 0 }}>
            <rect x="18" y="2" width="36" height="52" rx="5" fill="var(--paper, #fffdf8)" stroke="var(--tertiary)" strokeWidth="2" />
            <path d="M28 10h16" stroke="var(--label)" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M24 19h24M24 26h24M24 33h16M24 40h24M24 47h12" stroke="var(--separator)" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
            <span className="t-headline">原始电子试卷</span>
            <span className="t-foot c-sec">还原后的干净原卷，空格留白，可以整张再做一遍；附作答与批改对照表。</span>
            <span className="t-cap c-sec">{scanned.length} 张试卷</span>
          </span>
          <Icon name={kind === "paper" ? "checkcircle" : "chevron-right"} size={22} style={{ color: kind === "paper" ? "var(--brand)" : "var(--tertiary)" }} />
        </button>
      )}

      {kind === "book" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 2px" }}>
          <span className="t-foot" style={{ fontWeight: 700, color: "var(--secondary)", display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="list" size={14} stroke={2.2} />错题本里放哪些题</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className={`chip chip--select${scope === "all" ? " on" : ""}`} onClick={() => setScope("all")}>全部 {errors.length}</button>
            <button className={`chip chip--select${scope === "open" ? " on" : ""}`} onClick={() => setScope("open")}>只要没订正的 {openErrors.length}</button>
          </div>
        </div>
      )}

      <Button icon="sparkles" onClick={run} disabled={busy}>{busy ? "生成中…" : "生成 PDF"}</Button>
      <Button variant="plain" onClick={onClose} style={{ height: 44 }}>取消</Button>
    </Sheet>
  );
}
