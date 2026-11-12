import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../../components/Icon";
import { Button, Sheet } from "../../components/ui";
import { Avatar, SubjectTile } from "../../components/v2";
import { toPage, type FullPage } from "../../lib/folders";
import { pickImages, takePhoto } from "../../lib/native";
import { teacherLine, createdLabel, type PlanInfo, type PlanSubject } from "../../lib/plans";
import { toast, toastError } from "../../store/banner";
import { useAuth } from "../../store/auth";
import "../../styles/plans.css";

/** 图标 + 数字的一小格：人数、份数、对 / 错 / 没做都用它，代替「已交 3」这类文字 */
export function Count({ icon, color = "var(--secondary)", children }: { icon: IconName; color?: string; children: ReactNode }) {
  return <span className="plan-count" style={{ color }}><Icon name={icon} size={14} stroke={2.4} /><span className="num">{children}</span></span>;
}

/** 一个成员交了几份 / 共几份：小进度环 + 「3/4」，代替笼统的「已交 / 未交」。交齐 = 绿色实心勾，交了一部分 = 橙色弧，一份没交 = 灰色空环 */
export function SubmitProgress({ done, total }: { done: number; total: number }) {
  if (total <= 0) return null;
  const n = Math.max(0, Math.min(done, total));
  const full = n >= total;
  const color = full ? "var(--mastered)" : n > 0 ? "var(--accent-on, #8a4b00)" : "var(--tertiary)";
  const r = 9.5;
  const len = 2 * Math.PI * r;
  return (
    <span className="plan-progress" aria-label={full ? `${total} 份都交了` : `交了 ${n} 份，共 ${total} 份`}>
      <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
        {full ? (
          <>
            <circle cx="12" cy="12" r="11" fill="var(--mastered)" />
            <path d="M7 12.4l3.3 3.3L17 8.6" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r={r} fill="none" stroke="var(--fill)" strokeWidth="3.4" />
            {n > 0 && <circle cx="12" cy="12" r={r} fill="none" stroke={color} strokeWidth="3.4" strokeLinecap="round" strokeDasharray={`${(len * n) / total} ${len}`} transform="rotate(-90 12 12)" />}
          </>
        )}
      </svg>
      <span className="plan-progress__frac num" style={{ color }}><b>{n}</b>/{total}</span>
    </span>
  );
}

/**
 * 成员看到的「这是谁的哪个学习计划」：创建人头像、计划名、创建人称呼 · 学科、创建时间。
 * 作业页上用它，点一下去学习计划页看全部作业（more 是右边那句话）。
 */
export function PlanCreator({ plan, more, onClick }: { plan: PlanInfo; more?: string; onClick?: () => void }) {
  const body = (
    <>
      <Avatar name={plan.teacher} url={plan.teacherAvatar} size={44} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2, textAlign: "left" }}>
        <span className="t-headline ellipsis">{plan.name}</span>
        <span className="t-foot c-sec ellipsis">{teacherLine(plan.teacher, plan.subject)}</span>
        <span className="t-foot c-sec">{createdLabel(plan.createdAt)}</span>
      </span>
      {onClick && (
        <span className="t-foot c-sec" style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
          {more}<Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
        </span>
      )}
    </>
  );
  const style = { flexDirection: "row", alignItems: "center", gap: 12 } as const;
  return onClick ? <button className="card" style={style} onClick={onClick}>{body}</button> : <div className="card" style={style}>{body}</div>;
}

type Score = { correct: number; wrong: number; blank: number };

/** 一行里的对 / 错 / 没做：绿勾、红叉、灰横线各带一个数字 */
export function ScoreCounts({ score }: { score: Score }) {
  return (
    <span className="plan-counts" aria-label={`对 ${score.correct}，错 ${score.wrong}，没做 ${score.blank}`}>
      <Count icon="checkcircle" color="var(--mastered)">{score.correct}</Count>
      <Count icon="xcircle" color="var(--wrong)">{score.wrong}</Count>
      <Count icon="minus" color="var(--tertiary)">{score.blank}</Count>
    </span>
  );
}

/** 对 / 错 / 没做三个色块：图标 + 大数字，不写字 */
export function ScoreStats({ score }: { score: Score }) {
  const cell = (label: string, icon: IconName, color: string, bg: string, n: number) => (
    <div className="stat plan-stat--icon" style={{ background: bg, color }} aria-label={`${label} ${n}`}>
      <Icon name={icon} size={20} stroke={2.4} />
      <span className="stat__value num">{n}</span>
    </div>
  );
  return (
    <div className="plan-stats plan-stats--3">
      {cell("对", "checkcircle", "var(--mastered)", "var(--mastered-bg)", score.correct)}
      {cell("错", "xcircle", "var(--wrong)", "var(--wrong-bg)", score.wrong)}
      {cell("没做", "minus", "var(--secondary)", "var(--fill-light)", score.blank)}
    </div>
  );
}

/** 学科方块：综合用中性色 */
export function PlanTile({ subject, size = "md" }: { subject: PlanSubject | null | undefined; size?: "lg" | "md" | "sm" | "xs" }) {
  return <SubjectTile subject={subject && subject !== "mixed" ? subject : null} size={size} />;
}

/** 扫描：拍照（可以连着拍）或从相册选，返回带原图的照片 */
export function useScanPick(onPages: (pages: FullPage[]) => void, title = "扫描") {
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const fail = (e: unknown) => toastError((e as Error).message === "permission_denied" ? new Error("需要相机 / 相册权限，可以在系统设置里打开") : e);

  const camera = async () => {
    setOpen(false);
    try {
      const src = await takePhoto();
      if (!src) return;
      onPages([await toPage(src)]);
    } catch (e) {
      fail(e);
    }
  };
  const album = async () => {
    setOpen(false);
    try {
      const list = await pickImages(0);
      if (!list.length) return;
      setReading(true);
      const pages: FullPage[] = [];
      for (const src of list) pages.push(await toPage(src));
      onPages(pages);
    } catch (e) {
      fail(e);
    } finally {
      setReading(false);
    }
  };

  const sheet = (
    <>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <div className="add-grid">
          <button className="add-tile" onClick={camera}>
            <span className="add-tile__icon"><Icon name="camera" size={28} stroke={2} /></span>
            <span className="t-headline">拍照</span>
            
          </button>
          <button className="add-tile" onClick={album}>
            <span className="add-tile__icon"><Icon name="photo" size={28} stroke={2} /></span>
            <span className="t-headline">相册</span>
            
          </button>
        </div>
      </Sheet>
      {reading && <Busy text="正在读取照片" />}
    </>
  );
  return { open: () => setOpen(true), sheet };
}

export function Busy({ text }: { text: string }) {
  return (
    <div className="hud" role="dialog" aria-live="polite">
      <div className="hud__card"><span className="spinner-ring" /><span className="t-sub">{text}</span></div>
    </div>
  );
}

/**
 * 起名字 / 改名字。改的是账号的称呼，所有学习计划里老师看到的名字跟着变。
 * required：刚注册的新用户加入计划前必须先起名字，不能关掉。
 */
export function NameSheet({ open, required, onClose, onDone }: { open: boolean; required?: boolean; onClose: () => void; onDone: (name: string) => void }) {
  const { user, updateProfile } = useAuth();
  const current = user?.nickname && user.nickname !== "小同学" ? user.nickname : "";
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setName(current); }, [open, current]);
  const save = async () => {
    const value = name.trim();
    if (!value) return toast("写上你的名字，老师才知道是谁交的作业");
    setBusy(true);
    try {
      await updateProfile({ nickname: value });
      onDone(value);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={required ? () => undefined : onClose} title={required ? "你的名字" : "改名字"}>
      <p className="t-foot c-sec">写真实姓名，老师才认得出你</p>
      <input className="input" value={name} maxLength={16} placeholder="你的名字" autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
      <Button onClick={save} disabled={busy || !name.trim()}>{required ? "加入" : "保存"}</Button>
    </Sheet>
  );
}

/** 二次确认 */
export function ConfirmSheet({ open, title, text, action, danger, onClose, onConfirm }: { open: boolean; title: string; text?: string; action: string; danger?: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {text && <p className="t-sub c-sec">{text}</p>}
      <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>{action}</Button>
      <Button variant="plain" onClick={onClose}>取消</Button>
    </Sheet>
  );
}
