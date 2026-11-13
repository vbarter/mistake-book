import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { assetUrl } from "../../api/client";
import { useCelebrate } from "../../components/Celebrate";
import { Icon } from "../../components/Icon";
import { SwipeRow } from "../../components/SwipeRow";
import { Button, Sheet } from "../../components/ui";
import { Stat, Tag } from "../../components/v2";
import { haptic, pickImages, takePhoto } from "../../lib/native";
import { AI_GRADING, HW_PREVIEW, STATUS_LABEL, shownStatus, canHandIn, canWithdraw, dueLabel, fetchAssignment, fileBadge, handInLabel, hwMeta, isOverdue, planGone, sizeLabel, submitHomework, withdrawHomework, type MemberAssignment, type PlanDetailRes, type PlanFileView } from "../../lib/plans";
import { canUseLiveCamera } from "../../lib/scanCamera";
import { toast, toastError } from "../../store/banner";
import { useExports } from "../../store/exports";
import { addAlbumPages, clearScan, removeShot, restoreDraft, startScan, useScan } from "../../store/scan";
import { openFile } from "./Assignment";
import { Busy, Count } from "./shared";

const SWIPE_HINT = "zcb.plan.unbindHint";
function swipeHintPending(): boolean {
  try {
    return !localStorage.getItem(SWIPE_HINT);
  } catch {
    return false;
  }
}

type Look = "done" | "returned" | "todo" | "revoked";
/** 一份作业的样子：交了 = 绿，退回重做 = 红，没交 = 不上色 */
const lookOf = (a: MemberAssignment): Look => { const st = shownStatus(a.status); return st === "submitted" || st === "reviewed" ? "done" : st === "returned" ? "returned" : a.revoked ? "revoked" : "todo"; };

/**
 * 成员看到的学习计划页（和小程序的 components/PlanMember 对应）。成员不再有单独的「作业」页，全在这一页：
 * 待交 / 已交两个数，下面一份作业一张卡片：头部是序号 + 作业名 + 布置日期和文件数 + 自己的状态（待交 / 已交 / 退回重做），文件缩进排在下面（点文件打开）。
 * 待交和退回的默认展开，交过的收起，点头部展开 / 收起；文件多于 3 个先显示 3 个。底部「导出」「交作业」。
 * 交作业：连拍扫描（pages/scan，拍完回到这里）或相册选好照片 → 选这次交的是哪一份作业 → 交给老师；
 * 交完页面跟着刷新，交了的作业整张标成绿色，退回的标红。交了、老师还没批阅的那份可以整张向左滑，露出「解绑」：撤掉自己交的那份，回到没交，可以重新扫描上传。
 * 批改关着时，交过的作业展开后最下面多一行「我交的作业」，点开看自己交上去的照片。
 *AI 批改开着（AI_GRADING）时下面多一行对 / 错 / 没做，点进去看自己那份的批改结果。
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
  const [myHw, setMyHw] = useState<{ title: string; files: PlanFileView[] } | null>(null); // 正在看的：自己交到哪份作业的那几页
  const [swiped, setSwiped] = useState<string | null>(null); // 左滑开着的那份作业
  const [opened, setOpened] = useState<Record<string, boolean>>({}); // 手动展开 / 收起过的作业（没动过的：待交、退回的展开，交过的收起）
  const [full, setFull] = useState<Record<string, boolean>>({}); // 文件全部展开了的作业
  const [hint, setHint] = useState(swipeHintPending); // 第一次有交过的作业：那一行自己滑出一小截，露一下「解绑」

  useEffect(() => { void restoreDraft(); }, []);
  // 从相机回来、相册选完（或上次拍了没交）：直接弹出「交到哪一份」
  const n = shots.length;
  const seen = useRef(0);
  useEffect(() => {
    if (n > seen.current) setHanding(true);
    seen.current = n;
  }, [n]);

  const [cele, celebrate] = useCelebrate();
  const todo = list.filter((a) => !a.revoked && (a.status === "todo" || a.status === "returned"));
  const handed = list.filter((a) => a.status === "submitted" || a.status === "reviewed").length;
  const open = list.filter(canHandIn);
  // 选中的那份：只有一份待交（或只有一份能交）时不用选
  const chosen = open.find((a) => a.id === target) ?? (todo.length === 1 ? todo[0] : open.length === 1 ? open[0] : null);
  const pages = shots.flatMap((s) => (s.page ? [s.page] : []));
  const busy = shots.some((s) => s.status === "busy");
  const exportable = list.filter((a) => a.digitized || (a.files ?? []).length > 0);

  /** 看自己交上去的那几页：批改关着时照片只在服务器上 */
  const viewMine = async (a: MemberAssignment) => {
    try {
      const sub = (await fetchAssignment(a.id)).submission;
      if (!sub?.files.length) return toast("没找到交上去的照片");
      setMyHw({ title: a.title, files: sub.files });
    } catch (e) {
      toastError(e);
      if (planGone(e)) void reload();
    }
  };
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
      // 交上了：庆祝一下；这一份交完就没有待交的了，算「交齐」，纸屑多一些
      const cleared = todo.every((a) => a.id === chosen.id);
      celebrate({ title: "交上啦！", sub: cleared && list.length > 1 ? `${chosen.title} · 作业都交齐了` : chosen.title, big: cleared });
      await reload();
    } catch (e) {
      toastError(e);
      if (planGone(e)) return void reload(); // 计划被解散 / 自己被移出了：重新拉一次，页面换成提示
      setHanding(true);
    } finally {
      setStage(null);
    }
  };

  const withdraw = async (a: MemberAssignment) => {
    setSwiped(null);
    try {
      await withdrawHomework(a.id);
      toast("已解绑", "success");
    } catch (e) {
      toastError(e);
    }
    await reload();
  };
  const firstSwipe = list.find(canWithdraw)?.id;
  /** 这份作业在页面上的序号（卡片头部左边那个数） */
  const noOf = (a: MemberAssignment) => list.length - list.findIndex((x) => x.id === a.id);

  const exportPdf = async (a: MemberAssignment) => {
    try {
      const digitized = (await fetchAssignment(a.id)).assignment.digitized;
      if (!digitized) throw new Error("电子版还没准备好");
      const job = await submitExport({ kind: "clean", title: a.title, papers: [{ title: a.title, scannedAt: "", pages: digitized.pages, questions: digitized.questions }] });
      setExporting(false);
      toast(job ? (job.status === "done" ? "已生成" : "正在生成，好了会提醒你") : "服务器暂时不支持导出");
    } catch (e) {
      toastError(e);
      if (planGone(e)) void reload();
    }
  };

  /** 头部右边自己的状态：待交 / 已交 / 已阅 / 退回重做 / 已删除 */
  const statusTag = (a: MemberAssignment, st = shownStatus(a.status)) =>
    a.revoked && st === "todo" ? <Tag kind="neutral">已删除</Tag> : (
      <Tag
        kind={st === "todo" ? "pending" : st === "returned" ? "wrong" : "correct"}
        icon={st === "todo" ? "clock" : st === "returned" ? "refresh" : undefined}
        style={st === "submitted" || st === "reviewed" ? { background: "var(--card)" } : undefined}
      >{STATUS_LABEL[st]}</Tag>
    );

  return (
    <>
      {cele}
      <div className="plan-stats">
        <Stat icon="clock" label="待交" value={todo.length} />
        <Stat icon="checkcircle" label="已交" value={handed} color={handed ? "var(--mastered)" : undefined} />
      </div>
      {list.length === 0 && (
        <div className="group">
          <div className="hw-empty">
            <Icon name="document" size={34} stroke={1.6} style={{ color: "var(--tertiary)" }} />
            <b>还没有作业</b>
            <span>老师布置后会出现在这里</span>
          </div>
        </div>
      )}
      {/* 一份作业一张卡片（计划名在导航栏，创建时间在页面头部创建人名字下面） */}
      {list.map((a, i) => {
        const look = lookOf(a);
        const st = shownStatus(a.status);
        const waiting = st === "todo" || st === "returned";
        const mine = st !== "todo";
        const files = a.files ?? [];
        const open = opened[a.id] ?? (waiting && !a.revoked);
        const shownFiles = open ? (full[a.id] ? files : files.slice(0, HW_PREVIEW)) : [];
        const rest = files.length - HW_PREVIEW;
        const toggle = () => setOpened((o) => ({ ...o, [a.id]: !open }));
        const body = (
          <>
            <div className="hw-head" role="button" tabIndex={0} aria-expanded={open} onClick={toggle} onKeyDown={(e) => { if (e.key === "Enter") toggle(); }}>
              <span className="hw-no">{list.length - i}</span>
              <span className="hw-main">
                <span className="hw-title ellipsis">{a.title}</span>
                <span className="hw-sub">
                  <span className="ellipsis" style={{ flex: 1, color: waiting && isOverdue(a.dueAt) ? "var(--wrong)" : undefined }}>{hwMeta(a)}{waiting && a.dueAt ? ` · ${dueLabel(a.dueAt)}截止` : ""}{a.late ? " · 迟交" : ""}</span>
                </span>
              </span>
              {statusTag(a)}
              <Icon name={open ? "chevron-up" : "chevron-down"} size={16} stroke={2.4} style={{ color: "var(--tertiary)", flexShrink: 0 }} />
            </div>
            {shownFiles.map((f) => (
              <button key={f.id} className="row hw-file" onClick={() => openFile(f)}>
                <span className="plan-file__icon" style={{ width: 34, height: 40 }}>{fileBadge(f.mime)}</span>
                <span className="row__main"><span className="hw-file__name ellipsis">{f.name}</span><span className="row__sub">{sizeLabel(f.size)}</span></span>
                <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
              </button>
            ))}
            {open && rest > 0 && (
              <button className="hw-foot" onClick={() => setFull((m) => ({ ...m, [a.id]: !m[a.id] }))}>
                {full[a.id] ? "收起" : `其余 ${rest} 个文件`}<Icon name={full[a.id] ? "chevron-up" : "chevron-down"} size={13} stroke={2.4} />
              </button>
            )}
            {/* 退回重做：一句提醒；老师留的话跟在后面 */}
            {open && st === "returned" && <div className="hw-foot hw-foot--wrong">老师退回了，重新交一次</div>}
            {open && a.comment && (
              <div className={`hw-foot hw-foot--note ${st === "returned" ? "hw-foot--wrong" : "hw-foot--mute"}`}>
                <Icon name="bubble" size={14} stroke={2.2} style={{ marginTop: 3, flexShrink: 0 }} />
                <span style={{ flex: 1, textAlign: "left" }}>{a.comment}</span>
              </div>
            )}
            {/* 批改开着：交过的多一行对 / 错 / 没做，点进去看自己那份的批改结果 */}
            {open && AI_GRADING && mine && (
              <button className="hw-foot hw-foot--mute" onClick={() => nav(`/plans/a/${a.id}`)}>
                <span className="plan-counts" style={{ flex: 1 }}>
                  {a.score ? (
                    <>
                      <Count icon="checkcircle" color="var(--mastered)">{a.score.correct}</Count>
                      <Count icon="xcircle" color="var(--wrong)">{a.score.wrong}</Count>
                      <Count icon="minus" color="var(--tertiary)">{a.score.blank}</Count>
                    </>
                  ) : st === "returned" ? null : "批改中"}
                </span>
                批改结果<Icon name="chevron-right" size={13} stroke={2.4} style={{ color: "var(--tertiary)" }} />
              </button>
            )}
            {/* 批改关着：交过的多一行「我交的作业」，点开看自己交上去的照片 */}
            {open && !AI_GRADING && mine && (
              <button className="hw-foot hw-foot--mute" onClick={() => void viewMine(a)}>
                <Icon name="photo" size={14} stroke={2.2} />
                <span style={{ flex: 1, textAlign: "left" }}>我交的作业</span>
                查看<Icon name="chevron-right" size={13} stroke={2.4} style={{ color: "var(--tertiary)" }} />
              </button>
            )}
          </>
        );
        // 交了、老师还没批阅：这一份整张可以向左滑出「解绑」
        return canWithdraw(a) ? (
          <div key={a.id} className={`hw hw--${look}`}>
            <SwipeRow
              className="group"
              label="解绑"
              icon="unlink"
              open={swiped === a.id}
              onOpenChange={(o) => setSwiped((cur) => (o ? a.id : cur === a.id ? null : cur))}
              onDelete={() => void withdraw(a)}
              hint={hint && a.id === firstSwipe}
              onHintDone={() => {
                setHint(false);
                try {
                  localStorage.setItem(SWIPE_HINT, "1");
                } catch {
                  /* 存不下：下次再演示一遍 */
                }
              }}
            >
              {body}
            </SwipeRow>
          </div>
        ) : (
          <div key={a.id} className={`group hw hw--${look}`}>{body}</div>
        );
      })}

      <div className="bottom-bar" style={{ marginTop: "auto" }}>
        <Button variant="outline" icon="printer" disabled={exportable.length === 0} onClick={() => setExporting(true)}>导出</Button>
        {open.length > 0 && (
          <Button icon={n ? "check" : "camera"} onClick={() => (n ? setHanding(true) : setPicking(true))}>{n ? `交作业 · ${n} 页` : "交作业"}</Button>
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
        {/* 下拉选择：列出所有还能交的作业 */}
        <select className="input plan-select" aria-label="交到哪一份作业" value={chosen?.id ?? ""} onChange={(e) => setTarget(e.target.value || null)}>
          {!chosen && <option value="">请选择作业</option>}
          {open.map((a) => <option key={a.id} value={a.id}>{handInLabel(a, noOf(a))}</option>)}
        </select>
        {/* 选中的那份：再说一遍是哪天布置的、里面几个文件，确认交的是整份作业 */}
        {chosen && <p className="t-foot c-sec">{`作业 ${noOf(chosen)} · ${hwMeta(chosen)}`}</p>}
        {chosen?.status === "submitted" && <p className="t-foot c-sec">这份交过了，再交会换掉上次那份</p>}
        <Button icon="check" disabled={!chosen || !pages.length || busy || Boolean(stage)} onClick={hand}>{busy ? "照片调正中…" : "交给老师"}</Button>
      </Sheet>

      {/* 自己交上去的那几页：一页页往下排，点一页用系统预览放大 */}
      <Sheet open={myHw !== null} onClose={() => setMyHw(null)} title={`我交的作业 · ${myHw?.files.length ?? 0} 页`}>
        <span className="t-headline ellipsis" style={{ flexShrink: 0 }}>{myHw?.title}</span>
        {(myHw?.files ?? []).map((f) => (f.url ? <img key={f.id} className="plan-photo" style={{ flexShrink: 0 }} src={assetUrl(f.url)} alt={f.name} loading="lazy" onClick={() => void openFile(f)} /> : <div key={f.id} className="plan-files__empty card">「{f.name}」还在上传</div>))}
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
