import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { ScanViewer } from "../../components/ScanViewer";
import { Button, InlineNav, Segmented, Sheet } from "../../components/ui";
import { SubjectTile } from "../../components/v2";
import { warnPhotoDuplicates } from "../../lib/dedup";
import { finishFlow } from "../../lib/flow";
import { addPaper, folderStats, listFolders, thumbOf, type Folder, type FullPage } from "../../lib/folders";
import { submitScan } from "../../lib/jobs";
import { haptic, pickImages } from "../../lib/native";
import { hamming } from "../../lib/photoPrint";
import { canUseLiveCamera } from "../../lib/scanCamera";
import { findIssues } from "../../lib/scanProcess";
import { toast, toastError, useBanner } from "../../store/banner";
import { addAlbumPages, clearScan, moveShot, removeShot, restoreDraft, restoreShot, setMode, setScanFolder, toggleCut, unitsOf, useScan, type ScanMode } from "../../store/scan";

/** 长按多久开始拖动（毫秒）；按下后手指挪动超过 MOVE_CANCEL 就当作滚动，不拖 */
const LONG_PRESS = 380;
const MOVE_CANCEL = 8;

/**
 * 整理：拍完（或从相册选完）在这里确认，然后开始识别。
 * 1. 自动标出可能不用要的照片（和上一张几乎一样、拍糊了），一键去掉，可撤销；
 * 2. 分份：一份 = 一张卷子（可以多页）。全部一份 / 每张一份 / 自己分：点两张之间的 🔗 拆开，点「连成一份」接起来；长按照片拖动换顺序；
 * 3. 开始识别：每份建一张试卷、上传、交给服务器识别，回到文件夹看进度。
 */
export default function ScanArrange() {
  const nav = useNavigate();
  const shots = useScan((s) => s.shots);
  const cuts = useScan((s) => s.cuts);
  const mode = useScan((s) => s.mode);
  const folderId = useScan((s) => s.folderId);
  const restored = useScan((s) => s.restored);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [picking, setPicking] = useState(false);
  const [quitting, setQuitting] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number; x: number; y: number } | null>(null);
  const [fresh, setFresh] = useState<string | null>(null); // 刚拆出来 / 刚接上的那份（第一张的 id），闪一下
  const listRef = useRef<HTMLDivElement>(null);
  const warned = useRef(new Set<string>());

  useEffect(() => {
    void restoreDraft();
    listFolders().then(setFolders).catch(() => setFolders([]));
  }, []);

  // 草稿也读过了还是一张都没有：回首页
  useEffect(() => {
    if (restored && !shots.length && !progress) nav("/home", { replace: true });
  }, [restored, shots.length, progress, nav]);

  // 新处理好的照片：之前是不是已经导入过（和别的试卷里的照片一样）
  useEffect(() => {
    const ready = shots.filter((s) => s.page && !warned.current.has(s.id));
    if (!ready.length) return;
    ready.forEach((s) => warned.current.add(s.id));
    void warnPhotoDuplicates(ready.map((s) => s.page!), null, (f, p) => nav(`/papers/${f}/${p}`));
  }, [shots, nav]);

  const issues = useMemo(() => findIssues(shots.map((s) => ({ id: s.id, dhash: s.page?.dhash, sharp: s.sharp })), hamming), [shots]);
  const units = useMemo(() => unitsOf(shots, cuts), [shots, cuts]);
  const busy = shots.filter((s) => s.status === "busy").length;
  const folder = folders.find((f) => f.id === folderId) ?? null;

  const flash = (id: string) => {
    setFresh(id);
    window.setTimeout(() => setFresh((x) => (x === id ? null : x)), 700);
  };

  const removeIssues = () => {
    const removed = [...issues.keys()].map((id) => removeShot(id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
    if (!removed.length) return;
    void haptic.light();
    useBanner.getState().show(`已去掉 ${removed.length} 张`, { action: { label: "撤销", onClick: () => removed.slice().reverse().forEach(restoreShot) } });
  };

  const removeOne = (id: string) => {
    const r = removeShot(id);
    if (!r) return;
    useBanner.getState().show("已去掉 1 张", { action: { label: "撤销", onClick: () => restoreShot(r) } });
  };

  const split = (id: string) => {
    toggleCut(id);
    flash(id);
    void haptic.selection();
  };

  const addFromAlbum = async () => {
    try {
      const list = await pickImages(0);
      if (list.length) await addAlbumPages(list);
    } catch (e) {
      toastError((e as Error).message === "permission_denied" ? new Error("需要相册权限，可以在系统设置里打开") : e);
    }
  };

  const moreShots = () => nav("/scan", { replace: true, state: { folderId, from: useScan.getState().from } });

  const quit = () => {
    clearScan();
    setQuitting(false);
    finishFlow(nav, null, useScan.getState().from || "/home");
  };

  const start = async () => {
    const st = useScan.getState();
    const groups = unitsOf(st.shots, st.cuts).map((u) => u.map((i) => st.shots[i].page).filter((p): p is FullPage => Boolean(p)));
    if (!groups.length || groups.some((g) => !g.length)) return;
    let target = st.folderId;
    let ok = 0;
    try {
      for (let t = 0; t < groups.length; t++) {
        setProgress(groups.length > 1 ? `正在上传第 ${t + 1} / ${groups.length} 份` : "正在上传试卷");
        const { folder: f, paper } = await addPaper(target, groups[t]);
        target = f.id;
        try {
          await submitScan(f.id, paper.id, groups[t]);
          ok += 1;
        } catch (e) {
          toastError(e);
        }
      }
    } catch (e) {
      toastError(e);
    }
    if (!target) {
      setProgress(null);
      return;
    }
    void haptic.success();
    if (ok) toast(`已开始识别 ${ok} 份，好了会自动归档到知识点`, "success");
    const from = st.from;
    clearScan();
    finishFlow(nav, from, `/papers/${target}`);
  };

  // ---------------- 长按拖动换顺序
  // 用原生 touch 监听：拖动开始后要 preventDefault 挡住页面滚动，React 的 touch 事件是被动的，挡不住
  const dragRef = useRef<{ from: number; timer: number; x: number; y: number; on: boolean; to: number } | null>(null);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const indexAt = (x: number, y: number): number => {
      const nodes = Array.from(el.querySelectorAll<HTMLElement>("[data-pg]"));
      let best = -1;
      let bestD = Infinity;
      for (const n of nodes) {
        const r = n.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const d = Math.hypot(cx - x, (cy - y) * 1.5);
        if (d < bestD) { bestD = d; best = Number(n.dataset.pg) + (x > cx ? 1 : 0); }
      }
      return best;
    };
    const onStart = (e: TouchEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-pg]");
      if (!target || e.touches.length !== 1) return;
      const t = e.touches[0];
      const from = Number(target.dataset.pg);
      const d = { from, x: t.clientX, y: t.clientY, on: false, to: from, timer: 0 };
      d.timer = window.setTimeout(() => {
        d.on = true;
        void haptic.rigid();
        setDrag({ from, to: from, x: d.x, y: d.y });
      }, LONG_PRESS);
      dragRef.current = d;
    };
    const onMove = (e: TouchEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const t = e.touches[0];
      if (!d.on) {
        if (Math.hypot(t.clientX - d.x, t.clientY - d.y) > MOVE_CANCEL) {
          window.clearTimeout(d.timer);
          dragRef.current = null;
        }
        return;
      }
      e.preventDefault();
      d.x = t.clientX;
      d.y = t.clientY;
      d.to = indexAt(t.clientX, t.clientY);
      setDrag({ from: d.from, to: d.to, x: d.x, y: d.y });
    };
    const onEnd = (e: TouchEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      window.clearTimeout(d.timer);
      if (!d.on) return;
      e.preventDefault(); // 拖完不要触发点开
      setDrag(null);
      let to = d.to;
      if (to > d.from) to -= 1;
      if (to >= 0 && to !== d.from) {
        moveShot(d.from, to);
        void haptic.light();
      }
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    el.addEventListener("touchcancel", onEnd, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const issueList = [...issues.entries()];
  const modeHint = mode === "one" ? "同一张卷子的几页选这个，跨页的题会自动接上。" : mode === "each" ? "一叠不同的练习选这个，每张各自识别、各自成卷。" : "点两张之间的 🔗 从这里拆开；点「连成一份」把上下两份接起来。长按照片可以拖动换顺序。";

  return (
    <div className="screen">
      <InlineNav
        title="整理照片"
        subtitle={`${shots.length} 张 · 分成 ${units.length} 份`}
        back
        backLabel={canUseLiveCamera() ? "接着拍" : undefined}
        onBack={canUseLiveCamera() ? moreShots : () => setQuitting(true)}
        right={<button className="nav-btn" onClick={() => setQuitting(true)}>放弃</button>}
      />
      <div className="screen__content screen__content--modal" style={{ gap: 12, paddingTop: 4, paddingBottom: 120 }} ref={listRef}>
        {issueList.length > 0 && (
          <div className="arr-issue">
            <div className="arr-issue__head">
              <span className="arr-issue__ic"><Icon name="warning" size={16} stroke={2.2} /></span>
              有 {issueList.length} 张可能不用要
              <Button size="xs" variant="danger" style={{ marginLeft: "auto", height: 30, fontSize: 14 }} onClick={removeIssues}>{issueList.length > 1 ? "都去掉" : "去掉"}</Button>
            </div>
            <div className="arr-issue__items">
              {issueList.map(([id, it]) => {
                const i = shots.findIndex((s) => s.id === id);
                const s = shots[i];
                if (!s) return null;
                return (
                  <button key={id} className="arr-issue__item" style={{ textAlign: "left" }} onClick={() => setViewer(i)}>
                    <img src={thumbOf(s.page)} alt="" />
                    <span><b>第 {i + 1} 张</b>{it.kind === "dup" ? `和第 ${(it.of ?? 0) + 1} 张重复` : "拍糊了，字可能看不清"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="group">
          <button className="row" style={{ minHeight: 52 }} onClick={() => setPicking(true)}>
            <span className="row__icon" style={{ background: "var(--brand)" }}><Icon name="folder" size={18} /></span>
            <span className="row__main"><span className="row__title">放进</span></span>
            <span className="row__value ellipsis" style={{ maxWidth: "55%" }}>{folder?.name ?? "新文件夹（自动命名）"}</span>
            <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
          </button>
        </div>

        {shots.length > 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Segmented<ScanMode> value={mode} onChange={setMode} options={[{ value: "one", label: "全部一份" }, { value: "each", label: "每张一份" }, { value: "custom", label: "自己分" }]} />
            <span className="t-foot c-sec" style={{ padding: "0 4px" }}>{modeHint}</span>
          </div>
        )}

        {units.map((u, ui) => {
          const first = shots[u[0]];
          return (
            <div key={first.id} style={{ display: "contents" }}>
              {ui > 0 && (
                <div className="arr-cut"><button onClick={() => split(first.id)}><Icon name="link" size={12} stroke={2.4} />连成一份</button></div>
              )}
              <div className="arr-unit" style={fresh === first.id ? { boxShadow: "0 0 0 2px var(--brand)" } : undefined}>
                <div className="arr-unit__head">
                  <span className="arr-unit__num">{ui + 1}</span>
                  <span className="arr-unit__title">第 {ui + 1} 份</span>
                  <span className="arr-unit__sub">{u.length} 张{u.length > 1 ? " · 跨页的题会接上" : ""}</span>
                </div>
                <div className="arr-strip">
                  {u.map((i, j) => {
                    const s = shots[i];
                    const it = issues.get(s.id);
                    const cls = ["arr-pg", it ? `arr-pg--${it.kind}` : "", drag?.from === i ? "arr-pg--drag" : "", drag && drag.to === i && drag.from !== i ? "arr-pg--target" : ""].filter(Boolean).join(" ");
                    return (
                      <div key={s.id} style={{ display: "contents" }}>
                        <div className={cls} data-pg={i} onClick={() => !drag && setViewer(i)} role="button" aria-label={`第 ${i + 1} 张，点开查看，长按拖动`}>
                          {s.page ? <img src={thumbOf(s.page)} alt="" draggable={false} /> : <span className="arr-pg__ph"><span className="spinner-ring" style={{ width: 20, height: 20, borderWidth: 2 }} /></span>}
                          <span className="arr-pg__n">{i + 1}</span>
                          {it && (
                            <button className="arr-pg__x" aria-label={`去掉第 ${i + 1} 张`} onClick={(e) => { e.stopPropagation(); removeOne(s.id); }}>
                              <Icon name="xmark" size={10} stroke={3} />
                            </button>
                          )}
                        </div>
                        {j < u.length - 1 && (
                          <button className="arr-seam" aria-label={`从第 ${i + 1}、${i + 2} 张之间拆开`} onClick={() => split(shots[u[j + 1]].id)}>
                            <span><Icon name="link" size={12} stroke={2.4} /></span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {ui === units.length - 1 && (
                    <button className="arr-add" onClick={addFromAlbum} aria-label="从相册加照片">
                      <Icon name="plus" size={18} stroke={2.4} />相册
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, padding: "10px 16px calc(var(--safe-bottom) + 12px)", background: "linear-gradient(to bottom, transparent, var(--bg) 22%)", display: "flex", flexDirection: "column", gap: 8, zIndex: 20 }}>
        <Button icon="viewfinder" onClick={start} disabled={Boolean(progress) || busy > 0 || !shots.length}>
          {busy ? `正在调正 ${busy} 张…` : `开始识别 ${units.length} 份`}
        </Button>
        <span className="t-cap c-sec" style={{ textAlign: "center" }}>识别在服务器上进行，提交后可以离开</span>
      </div>

      {drag && shots[drag.from]?.page && <img className="arr-ghost" src={thumbOf(shots[drag.from].page)} alt="" style={{ left: drag.x, top: drag.y }} />}

      {viewer !== null && <ScanViewer start={viewer} onClose={() => setViewer(null)} />}

      <Sheet open={picking} onClose={() => setPicking(false)} title="放进哪个文件夹？">
        <div className="group">
          <button className="row" style={{ minHeight: 56 }} onClick={() => { setScanFolder(null); setPicking(false); }}>
            <span className="row__icon" style={{ background: "var(--brand-tint)", color: "var(--brand)" }}><Icon name="plus" size={18} stroke={2.4} /></span>
            <span className="row__main"><span className="row__title">新文件夹</span><span className="row__sub">按日期和学科自动命名</span></span>
            {!folderId && <Icon name="check" size={18} stroke={2.6} style={{ color: "var(--brand)" }} />}
          </button>
          {folders.map((f) => (
            <button key={f.id} className="row" style={{ minHeight: 56 }} onClick={() => { setScanFolder(f.id); setPicking(false); }}>
              <SubjectTile subject={folderStats(f).subject} size="sm" />
              <span className="row__main"><span className="row__title">{f.name}</span><span className="row__sub">{f.papers.length} 份试卷</span></span>
              {folderId === f.id && <Icon name="check" size={18} stroke={2.6} style={{ color: "var(--brand)" }} />}
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={quitting} onClose={() => setQuitting(false)} title={`放弃这 ${shots.length} 张照片？`}>
        <span className="t-sub c-sec">放弃后照片会从手机上删掉，不会识别。</span>
        <Button variant="danger" onClick={quit}>放弃</Button>
        <Button variant="tinted" onClick={() => setQuitting(false)}>再想想</Button>
      </Sheet>

      {progress && (
        <div className="hud" role="dialog" aria-live="polite">
          <div className="hud__card">
            <span className="spinner-ring" />
            <span className="t-headline">{progress}…</span>
            <span className="t-foot c-sec">上传完就可以离开</span>
          </div>
        </div>
      )}
    </div>
  );
}
