import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Subject } from "../api/types";
import { Icon } from "../components/Icon";
import { Button, Empty, LargeNav, Sheet } from "../components/ui";
import { SubjectStack, SubjectTile, Tag, WrongRing, subjectColors } from "../components/v2";
import { folderErrors, groupByKnowledge } from "../lib/errors";
import { createFolder, defaultFolderName, folderStats, listFolders, type Folder } from "../lib/folders";
import { SUBJECTS, SUBJECT_LABEL, formatDate } from "../lib/format";
import { useJobs } from "../lib/jobs";
import { useCapture } from "../store/capture";

type Source = "camera" | "photos";

/** 试卷 Tab：一次考试一个文件夹。点开看里面的试卷和错题汇总；底栏一步录新试卷（先选文件夹或新建）。 */
export default function Papers() {
  const nav = useNavigate();
  const { reset, setReturnTo } = useCapture();
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [pick, setPick] = useState<Source | null>(null); // 选文件夹面板
  const [creating, setCreating] = useState<{ source: Source | null } | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState<Subject | undefined>(undefined);

  const jobsVersion = useJobs((s) => s.version);
  useEffect(() => {
    listFolders().then(setFolders).catch(() => setFolders([]));
  }, [jobsVersion]);

  const goCapture = (folderId: string | null, source: Source) => {
    reset();
    setReturnTo(folderId ? `/papers/${folderId}` : "/papers");
    nav("/capture", { state: { folderId, source } });
  };

  const startCapture = (source: Source) => {
    if (!folders || folders.length === 0) {
      setName(defaultFolderName());
      setSubject(undefined);
      setCreating({ source });
      return;
    }
    setPick(source);
  };

  const confirmCreate = async () => {
    const f = await createFolder(name || defaultFolderName(), subject);
    setCreating(null);
    setPick(null);
    if (creating?.source) goCapture(f.id, creating.source);
    else nav(`/papers/${f.id}`);
  };

  return (
    <div className="screen">
      <LargeNav title="我的试卷" actions={
        <button aria-label="新建文件夹" className="tile tile--sm" style={{ background: "var(--brand-tint)", color: "var(--brand-on-tint)", border: 0, width: 44, height: 44, borderRadius: 22 }} onClick={() => { setName(""); setSubject(undefined); setCreating({ source: null }); }}>
          <Icon name="plus" size={22} stroke={2.4} />
        </button>
      } />
      <div className="screen__content" style={{ paddingBottom: 0, gap: 12 }}>
        {folders && folders.length === 0 && (
          <Empty icon="folder" title="还没有试卷" text="拍下整页试卷或从相册多选，AI 会还原成电子版，找出错题并按知识点归类。" />
        )}

        {folders?.map((f) => {
          const st = folderStats(f);
          const kps = groupByKnowledge(folderErrors(f)).slice(0, 2);
          const more = Math.max(0, groupByKnowledge(folderErrors(f)).length - 2);
          const c = subjectColors(st.subject);
          return (
            <button key={f.id} className="card" style={{ gap: 12, textAlign: "left", width: "100%", padding: "14px 16px 14px 14px" }} onClick={() => nav(`/papers/${f.id}`)}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <SubjectStack subjects={st.subjects} size="md" />
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="t-headline ellipsis" style={{ fontWeight: 700 }}>{f.name}{st.subjects.length > 1 ? <span className="t-foot c-sec" style={{ fontWeight: 500 }}> · {st.subjects.map((s) => SUBJECT_LABEL[s]).join(" / ")}</span> : ""}</span>
                  <span className="t-foot c-sec" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="document" size={14} stroke={2} />{f.papers.length} 张</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="clock" size={14} stroke={2} />{formatDate(f.updatedAt)}</span>
                  </span>
                </div>
                {f.papers.some((p) => p.scanJob) ? (
                  <Tag kind="info" icon="sparkles">AI 还原中 {Math.min(...f.papers.filter((p) => p.scanJob).map((p) => p.scanJob!.progress))}%</Tag>
                ) : st.unscanned > 0 && st.problems === 0 ? <Tag kind="pending">{st.unscanned} 张待扫描</Tag> : <WrongRing wrong={st.problems} corrected={st.corrected} />}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="thumbs">
                  {f.papers.slice(0, 3).map((p) => (
                    <img key={p.id} className="thumb thumb--sm" src={p.pages[0]?.src} alt="" />
                  ))}
                </span>
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
                  {kps.map(([k, items]) => (
                    <span key={k} className="tag" style={{ background: c.bg, color: c.color, height: 24 }}>{k} {items.length}</span>
                  ))}
                  {more > 0 && <span className="tag tag--neutral">+{more}</span>}
                  {kps.length === 0 && <span className="t-foot c-sec">{st.unscanned > 0 ? "扫一下，错题就自动归到知识点里" : "没有错题，真棒"}</span>}
                </span>
                {st.blank > 0 && <Tag kind="pending" icon="alert">空 {st.blank}</Tag>}
                {st.problems > 0 && st.corrected > 0 && <Tag kind="correct">{st.corrected >= st.problems ? "全部订正" : `已订正 ${st.corrected}`}</Tag>}
                {st.unscanned > 0 && st.problems === 0 && <Tag kind="accent">去扫描</Tag>}
              </div>
            </button>
          );
        })}

        <div className="bottom-bar bottom-bar--tab" style={{ marginTop: "auto" }}>
          <Button icon="camera" onClick={() => startCapture("camera")} style={{ flex: 1.25 }}>拍试卷</Button>
          <Button variant="tinted" icon="photo" onClick={() => startCapture("photos")} style={{ flex: 1 }}>相册</Button>
        </div>
      </div>

      <Sheet open={Boolean(pick)} onClose={() => setPick(null)} title="放进哪个文件夹？">
        <div className="group">
          {folders?.map((f) => {
            const st = folderStats(f);
            return (
              <button key={f.id} className="row" style={{ minHeight: 56 }} onClick={() => { const s = pick!; setPick(null); goCapture(f.id, s); }}>
                <SubjectTile subject={st.subject} size="sm" />
                <span className="row__main"><span className="row__title">{f.name}</span><span className="row__sub">{f.papers.length} 张试卷</span></span>
                <Icon name="chevron-right" size={14} stroke={2.4} style={{ color: "var(--tertiary)" }} />
              </button>
            );
          })}
        </div>
        <Button variant="tinted" icon="plus" onClick={() => { setName(defaultFolderName()); setSubject(undefined); setCreating({ source: pick }); }}>新建文件夹</Button>
      </Sheet>

      <Sheet open={Boolean(creating)} onClose={() => setCreating(null)} title="新建文件夹">
        <input className="input" autoFocus value={name} maxLength={30} placeholder={defaultFolderName()} onChange={(e) => setName(e.target.value)} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SUBJECTS.map((s) => (
            <button key={s} className={`chip chip--select${subject === s ? " on" : ""}`} onClick={() => setSubject(subject === s ? undefined : s)} style={{ gap: 6 }}>
              <SubjectTile subject={s} size="xs" />{SUBJECT_LABEL[s]}
            </button>
          ))}
        </div>
        <span className="t-foot c-sec">学科可以不选，扫描后会自动判断。</span>
        <Button onClick={confirmCreate}>{creating?.source ? "建好并开始拍" : "建好"}</Button>
      </Sheet>
    </div>
  );
}
