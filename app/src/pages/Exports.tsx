import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { InlineNav } from "../components/ui";
import { Tag } from "../components/v2";
import { formatDateTime } from "../lib/format";
import { toastError } from "../store/banner";
import { isPending, openExport, useExports, type ExportJob } from "../store/exports";

const sizeLabel = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** 我的导出：最近 7 天在服务器上生成的错题本 / 电子试卷，点一下下载并分享；生成中的自动刷新。 */
export function Exports() {
  const { items, loaded, refresh, remove } = useExports();
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => { void refresh(); }, [refresh]);

  const open = async (job: ExportJob) => {
    if (job.status !== "done" || opening) return;
    setOpening(job.id);
    try {
      await openExport(job);
    } catch (e) {
      if (!/cancel/i.test(String((e as Error).message))) toastError(e);
    } finally {
      setOpening(null);
    }
  };
  const del = async (job: ExportJob) => {
    try { await remove(job.id); } catch (e) { toastError(e); }
  };

  return (
    <div className="screen">
      <InlineNav title="我的导出" back />
      <div className="screen__content screen__content--modal" style={{ paddingTop: 8, gap: 10 }}>
        {loaded && items.length === 0 && (
          <div className="empty">
            <Icon name="export" size={40} className="empty__icon" />
            <span className="empty__title">还没有导出过</span>
            <span className="t-foot">在错题榜或文件夹里点「导出」，PDF 会在后台生成，放在这里。</span>
          </div>
        )}
        {items.map((job) => {
          const pending = isPending(job);
          const busy = opening === job.id;
          return (
            <div key={job.id} className="card card--row" style={{ alignItems: "center", gap: 12 }}>
              <button onClick={() => open(job)} disabled={job.status !== "done" || busy} style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, minWidth: 0, background: "none", border: 0, padding: 0, textAlign: "left", color: "inherit" }}>
                <span className="tile tile--sm" style={{ background: "var(--brand-tint)", color: "var(--brand)", flexShrink: 0 }}><Icon name={job.kind === "book" ? "book" : "document"} size={20} stroke={2.2} /></span>
                <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                  <span className="t-headline ellipsis">{job.title}</span>
                  {job.detail && <span className="t-foot c-sec ellipsis">{job.detail}</span>}
                  <span className="t-cap c-sec">
                    {formatDateTime(job.createdAt)}
                    {job.status === "done" && ` · ${job.pages} 页 · ${sizeLabel(job.size)}`}
                  </span>
                  {job.status === "failed" && <span className="t-cap" style={{ color: "var(--wrong)" }}>{job.error || "生成失败"}</span>}
                </span>
                {pending && <Tag kind="pending" icon="clock">生成中</Tag>}
                {job.status === "done" && (busy ? <span className="t-foot c-sec">下载中…</span> : <Icon name="export" size={20} stroke={2.2} style={{ color: "var(--brand)" }} />)}
              </button>
              {!pending && (
                <button onClick={() => del(job)} aria-label="删除" style={{ background: "none", border: 0, padding: 6, color: "var(--tertiary)" }}>
                  <Icon name="trash" size={18} stroke={2} />
                </button>
              )}
            </div>
          );
        })}
        {items.length > 0 && <p className="t-cap c-sec" style={{ padding: "4px 12px 0" }}>导出的 PDF 在服务器上保留 7 天，方便换个时间再下载；不需要了可以删掉。</p>}
      </div>
    </div>
  );
}
