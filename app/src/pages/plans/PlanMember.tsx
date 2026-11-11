import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icon, type IconName } from "../../components/Icon";
import { Button, Sheet } from "../../components/ui";
import { Stat, Tag } from "../../components/v2";
import { haptic, pickImages, takePhoto } from "../../lib/native";
import { STATUS_LABEL, canHandIn, dueLabel, fetchAssignment, fileBadge, isOverdue, sizeLabel, submitHomework, type MemberAssignment, type PlanDetailRes } from "../../lib/plans";
import { canUseLiveCamera } from "../../lib/scanCamera";
import { toast, toastError } from "../../store/banner";
import { useExports } from "../../store/exports";
import { addAlbumPages, clearScan, removeShot, restoreDraft, startScan, useScan } from "../../store/scan";
import { openFile } from "./Assignment";
import { Busy, Count } from "./shared";

type Look = "done" | "returned" | "todo" | "revoked";
/** 一份作业的样子：交了 = 绿，退回重做 = 红，待交 = 橙 */
const lookOf = (a: MemberAssignment): Look => (a.status === "submitted" || a.status === "reviewed" ? "done" : a.status === "returned" ? "returned" : a.revoked ? "revoked" : "todo");
const LOOK_ICON: Record<Look, [IconName, string]> = { done: ["checkcircle", "var(--mastered)"], returned: ["refresh", "var(--wrong)"], todo: ["clock", "var(--due)"], revoked: ["minus", "var(--tertiary)"] };

/**
 * 成员看到的学习计划页（和小程序的 components/PlanMember 对应）。成员不再有单独的「作业」页，全在这一页：
 * 待交 / 已交两个数，每份作业一块（作业名 + 状态，下面直接平铺它的文件，点文件打开），底部「导出」「扫描上传」。
 * 扫描上传：连拍扫描（pages/scan，拍完回到这里）或相册选好照片 → 选这次交的是哪一份作业 → 交给老师；
 * 交完页面跟着刷新，交了的作业整块标成绿色。交过的作业点作业名看自己那份的批改结果。
 * 拍好还没交的照片放在连拍扫描的那一批里（store/scan，plan = 这个计划），App 被杀也还在。
 */
export function PlanMember({ data, reload }: { data: PlanDetailRes; reload: () => Promise<unknown> }) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { plan } = data;
  const list = data.assignments as MemberAssignment[];
  const submitExport = useExports((s) => s.submit);
  const scanPlan = useScan((s) => s.plan);
  const allShots = useScan((s) => s.shots);
  const shots = scanPlan === plan.id ? allShots : [];
  const [picking, setPicking] = useState(false);
  const [handing, setHanding] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { void restoreDraft(); }, []);
  // 从相机回来、相册选完（或上次拍了没交）：直接弹出「交到哪一份」
  const n = shots.length;
  const seen = useRef(0);
  useEffect(() => {
    if (n > seen.current) setHanding(true);
    seen.current = n;
  }, [n]);

  const todo = list.filter((a) => !a.revoked && (a.status === "todo" || a.status === "returned"));
  const handed = list.filter((a) => a.status === "submitted" || a.status === "reviewed").length;
  const open = list.filter(canHandIn);
  // 选中的那份：只有一份待交（或只有一份能交）时不用选
  const chosen = open.find((a) => a.id === target) ?? (todo.length === 1 ? todo[0] : open.length === 1 ? open[0] : null);
  const pages = shots.flatMap((s) => (s.page ? [s.page] : []));
  const busy = shots.some((s) => s.status === "busy");
  const exportable = list.filter((a) => a.digitized || (a.files ?? []).length > 0);

  const fail = (e: unknown) => toastError((e as Error).message === "permission_denied" ? new Error("需要相机 / 相册权限，可以在系统设置里打开") : e);
  const add = async (get: () => Promise<string[]>) => {
    setPicking(false);
    try {
      const srcs = await get();
      if (!srcs.length) return;
      startScan(null, pathname, plan.id);
      await addAlbumPages(srcs);
    } catch (e) {
      fail(e);
    }
  };
  const camera = () => {
    // 连拍扫描：页面里开相机，实时框出纸、拍一张接一张；用不了（老系统、个别 WebView）就用系统相机拍一张
    if (canUseLiveCamera()) {
      setPicking(false);
      nav("/scan", { state: { from: pathname, plan: plan.id } });
    } else void add(async () => [await takePhoto()].filter((s): s is string => Boolean(s)));
  };

  const hand = async () => {
    if (!chosen || !pages.length || busy) return;
    setHanding(false);
    try {
      await submitHomework(chosen, pages, setStage);
      clearScan();
      setTarget(null);
      void haptic.success();
      toast("交上去了", "success");
      await reload();
    } catch (e) {
      toastError(e);
      setHanding(true);
    } finally {
      setStage(null);
    }
  };

  const exportPdf = async (a: MemberAssignment) => {
    try {
      const digitized = (await fetchAssignment(a.id)).assignment.digitized;
      if (!digitized) throw new Error("电子版还没准备好");
      const job = await submitExport({ kind: "clean", title: a.title, papers: [{ title: a.title, scannedAt: "", pages: digitized.pages, questions: digitized.questions }] });
      setExporting(false);
      toast(job ? (job.status === "done" ? "已生成" : "正在生成，好了会提醒你") : "服务器暂时不支持导出");
    } catch (e) {
      toastError(e);
    }
  };

  const statusTag = (a: MemberAssignment, onTint = false) =>
    a.revoked ? <Tag kind="neutral">已撤回</Tag> : (
      <Tag
        kind={a.status === "todo" ? "pending" : a.status === "returned" ? "wrong" : "correct"}
        icon={a.status === "todo" ? "clock" : a.status === "returned" ? "refresh" : undefined}
        style={onTint && a.status !== "todo" ? { background: "var(--card)" } : undefined}
      >{STATUS_LABEL[a.status]}</Tag>
    );

  return (
    <>
      <div className="plan-stats">
        <Stat icon="clock" label="待交" value={todo.length} color={todo.length ? "var(--due)" : undefined} />
        <Stat icon="checkcircle" label="已交" value={handed} color={handed ? "var(--mastered)" : undefined} />
      </div>
      {list.length === 0 && <div className="group"><div className="plan-files__empty">还没有作业</div></div>}
      {list.map((a) => {
        const look = lookOf(a);
        const waiting = a.status === "todo" || a.status === "returned";
        const mine = a.status !== "todo"; // 交过：点作业名看自己那份和批改结果
        const head = (
          <>
            <span className="plan-task__head">
              <Icon name={LOOK_ICON[look][0]} size={18} stroke={2.4} style={{ color: LOOK_ICON[look][1], flexShrink: 0 }} />
              <span className="t-headline ellipsis" style={{ flex: 1 }}>{a.title}</span>
              {statusTag(a, true)}
              {mine && <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)", flexShrink: 0 }} />}
            </span>
            <span className="plan-counts" style={waiting && !a.dueAt ? { display: "none" } : undefined}>
              {waiting ? (a.dueAt && <Count icon="clock" color={isOverdue(a.dueAt) ? "var(--wrong)" : undefined}>{dueLabel(a.dueAt)}</Count>) : a.score ? (
                <>
                  <Count icon="checkcircle" color="var(--mastered)">{a.score.correct}</Count>
                  <Count icon="xcircle" color="var(--wrong)">{a.score.wrong}</Count>
                  <Count icon="minus" color="var(--tertiary)">{a.score.blank}</Count>
                </>
              ) : <span className="t-foot c-sec">批改中</span>}
              {!waiting && a.late && <span className="t-foot c-sec">迟交</span>}
            </span>
            {a.comment && (
              <span className="plan-count" style={{ alignItems: "flex-start", fontWeight: 400, color: a.status === "returned" ? "var(--wrong)" : "var(--secondary)" }}>
                <Icon name="bubble" size={14} stroke={2.2} style={{ marginTop: 2, flexShrink: 0 }} />
                <span style={{ flex: 1, textAlign: "left" }}>{a.comment}</span>
              </span>
            )}
          </>
        );
        return (
          <div key={a.id} className="group">
            {mine
              ? <button className={`plan-task plan-task--${look}`} onClick={() => nav(`/plans/a/${a.id}`)}>{head}</button>
              : <div className={`plan-task plan-task--${look} plan-task--static`}>{head}</div>}
            {(a.files ?? []).map((f) => (
              <button key={f.id} className="row" onClick={() => openFile(f)}>
                <span className="plan-file__icon" style={{ width: 34, height: 40 }}>{fileBadge(f.mime)}</span>
                <span className="row__main"><span className="row__title ellipsis">{f.name}</span><span className="row__sub">{sizeLabel(f.size)}</span></span>
                <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
              </button>
            ))}
          </div>
        );
      })}

      <div className="bottom-bar" style={{ marginTop: "auto" }}>
        <Button variant="outline" icon="printer" disabled={exportable.length === 0} onClick={() => setExporting(true)}>导出</Button>
        {open.length > 0 && (
          <Button icon={n ? "check" : "camera"} onClick={() => (n ? setHanding(true) : setPicking(true))}>{n ? `交作业 · ${n} 页` : "扫描上传"}</Button>
        )}
      </div>

      <Sheet open={picking} onClose={() => setPicking(false)} title="拍下做完的作业">
        <div className="add-grid">
          <button className="add-tile" onClick={camera}>
            <span className="add-tile__icon"><Icon name="camera" size={28} stroke={2} /></span>
            <span className="t-headline">拍照</span>
          </button>
          <button className="add-tile" onClick={() => void add(() => pickImages(0))}>
            <span className="add-tile__icon"><Icon name="photo" size={28} stroke={2} /></span>
            <span className="t-headline">相册</span>
          </button>
        </div>
      </Sheet>

      {/* 拍完：看一眼拍的几页，选这次交的是哪一份作业 */}
      <Sheet open={handing} onClose={() => setHanding(false)} title={`拍了 ${n} 页`}>
        <div className="plan-thumbs">
          {shots.map((s) => (
            <span key={s.id} className="plan-thumb">
              <img className="thumb" src={s.page?.thumb ?? s.raw} alt="" style={s.status === "busy" ? { opacity: 0.5 } : undefined} />
              <button className="plan-thumb__x" aria-label="去掉这一页" onClick={() => removeShot(s.id)}><Icon name="xmark" size={11} stroke={3} /></button>
            </span>
          ))}
          <button className="thumb plan-thumb__add" aria-label="再拍几页" onClick={() => { setHanding(false); setPicking(true); }}><Icon name="plus" size={18} stroke={2.4} /></button>
        </div>
        <p className="t-foot c-sec">交到哪一份作业</p>
        <div className="group" style={{ background: "var(--fill-light)" }}>
          {open.map((a) => {
            const on = chosen?.id === a.id;
            return (
              <button key={a.id} className="row" aria-pressed={on} onClick={() => setTarget(a.id)}>
                <span className={`plan-radio${on ? " plan-radio--on" : ""}`}>{on && <Icon name="check" size={13} stroke={3.2} />}</span>
                <span className="row__main">
                  <span className="row__title ellipsis">{a.title}</span>
                  {a.status === "submitted" && <span className="row__sub">交过了，再交会换掉上次那份</span>}
                </span>
                {statusTag(a)}
              </button>
            );
          })}
        </div>
        <Button icon="check" disabled={!chosen || !pages.length || busy || Boolean(stage)} onClick={hand}>{busy ? "照片调正中…" : "交给老师"}</Button>
      </Sheet>

      <Sheet open={exporting} onClose={() => setExporting(false)} title="导出作业">
        {exportable.map((a) => (
          <div key={a.id} className="group" style={{ background: "var(--fill-light)" }}>
            <div className="group__header"><span className="ellipsis">{a.title}</span></div>
            {a.digitized && (
              <button className="row" onClick={() => exportPdf(a)}>
                <span className="row__icon" style={{ background: "var(--brand)" }}><Icon name="printer" size={18} stroke={2} /></span>
                <span className="row__main"><span className="row__title">电子版 PDF</span></span>
              </button>
            )}
            {(a.files ?? []).map((f) => (
              <button key={f.id} className="row" onClick={() => openFile(f)}>
                <span className="row__icon" style={{ background: "var(--secondary)" }}><Icon name={f.mime.startsWith("image/") ? "photo" : "document"} size={18} stroke={2} /></span>
                <span className="row__main"><span className="row__title ellipsis">{f.name}</span><span className="row__sub">{sizeLabel(f.size)}</span></span>
              </button>
            ))}
          </div>
        ))}
      </Sheet>
      {stage && <Busy text={stage} />}
    </>
  );
}
