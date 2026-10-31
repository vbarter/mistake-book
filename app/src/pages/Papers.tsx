import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAddPaper } from "../components/AddSheet";
import { Icon } from "../components/Icon";
import { SwipeSortList } from "../components/SwipeSortList";
import { Buddy } from "../components/Illustration";
import { Button, Sheet } from "../components/ui";
import { toast } from "../store/banner";
import { SubjectTile, Tag, WrongRing, subjectColors } from "../components/v2";
import { folderErrors, groupByKnowledge } from "../lib/errors";
import { deleteFolder, folderStats, listFolders, reorderFolders, thumbOf, type Folder } from "../lib/folders";
import { SUBJECT_LABEL, formatDate } from "../lib/format";
import { scanStageText, useJobs } from "../lib/jobs";

/** 试卷 Tab：一次考试一个文件夹，自动建、自动命名。右上角 + 添加试卷（拍照 / 相册批量导入），不用先选文件夹。 */
export default function Papers() {
  const nav = useNavigate();
  const add = useAddPaper();
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [deleting, setDeleting] = useState<Folder | null>(null); // 左滑后点了删除，等确认

  const jobsVersion = useJobs((s) => s.version);
  useEffect(() => {
    listFolders().then(setFolders).catch(() => setFolders([]));
  }, [jobsVersion]);

  return (
    <div className="screen">
      <header className="topbar">
        <span className="t-foot c-sec" style={{ fontWeight: 600 }}>{folders ? `${folders.length} 个文件夹 · ${folders.reduce((n, f) => n + f.papers.length, 0)} 份试卷` : ""}</span>
        <span className="t-cap c-sec">左滑删除 · 长按拖动排序</span>
      </header>
      <div className="screen__content" style={{ paddingBottom: 0, gap: 12 }}>
        {folders && folders.length === 0 && (
          <div className="empty rise"><Buddy scene="empty" size={150} /><span className="empty__title">还没有试卷</span><span className="t-sub">点下面中间的相机，拍下整页试卷或从相册多选，错题会自动按知识点归类。</span><Button size="sm" icon="plus" onClick={add.open}>添加试卷</Button></div>
        )}

        {folders && folders.length > 0 && (
          <SwipeSortList
            items={folders}
            keyOf={(f) => f.id}
            onReorder={(ids) => {
              setFolders(ids.map((id) => folders.find((f) => f.id === id)!));
              void reorderFolders(ids);
            }}
            onDelete={setDeleting}
            render={(f) => {
          const st = folderStats(f);
          const kps = groupByKnowledge(folderErrors(f)).slice(0, 2);
          const more = Math.max(0, groupByKnowledge(folderErrors(f)).length - 2);
          const c = subjectColors(st.subject);
          return (
            <button key={f.id} className="card press" style={{ flexDirection: "row", alignItems: "center", gap: 12, textAlign: "left", width: "100%", padding: "14px 16px 14px 14px" }} onClick={() => nav(`/papers/${f.id}`)}>
              {/* 左：缩略图 + 标题 + 知识点；右：错题环 / 扫描状态，在整张卡片里上下居中 */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ position: "relative", flexShrink: 0, width: 48, height: 60 }}>
                    {f.papers[0]?.pages[0] ? (
                      <img className="thumb" src={thumbOf(f.papers[0].pages[0])} alt="" style={{ width: 48, height: 60 }} />
                    ) : (
                      <SubjectTile subject={st.subject} size="md" style={{ width: 48, height: 60, borderRadius: 10 }} />
                    )}
                    {f.papers[0]?.pages[0] && <SubjectTile subject={st.subject} size="xs" style={{ position: "absolute", right: -6, bottom: -6, boxShadow: "0 0 0 2px var(--card)" }} />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    <span className="t-headline ellipsis" style={{ fontWeight: 700 }}>{f.name}{st.subjects.length > 1 ? <span className="t-foot c-sec" style={{ fontWeight: 500 }}> · {st.subjects.map((s) => SUBJECT_LABEL[s]).join(" / ")}</span> : ""}</span>
                    <span className="t-foot c-sec" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="document" size={14} stroke={2} />{f.papers.length} 张</span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="clock" size={14} stroke={2} />{formatDate(f.updatedAt)}</span>
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
                    {kps.map(([k, items]) => (
                      <span key={k} className="tag" style={{ background: c.bg, color: c.color, height: 24 }}>{k} {items.length}</span>
                    ))}
                    {more > 0 && <span className="tag tag--neutral">+{more}</span>}
                    {kps.length === 0 && <span className="t-foot c-sec">{st.unscanned > 0 ? `${st.unscanned} 张待扫描，扫完错题自动归到知识点` : "没有错题，真棒"}</span>}
                  </span>
                </div>
              </div>
              <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                {f.papers.some((p) => p.scanJob) ? (
                  <Tag kind="info" icon="sparkles">{scanStageText([...f.papers.filter((p) => p.scanJob)].sort((a, b) => a.scanJob!.progress - b.scanJob!.progress)[0].scanJob!)}</Tag>
                ) : st.unscanned > 0 && st.problems === 0 ? <Tag kind="accent" icon="sparkles">去扫描</Tag> : <WrongRing wrong={st.problems} />}
              </span>
            </button>
          );
            }}
          />
        )}

      </div>

      <Sheet open={Boolean(deleting)} onClose={() => setDeleting(null)} title={`删除「${deleting?.name ?? ""}」？`}>
        <span className="t-body c-sec">里面的 {deleting?.papers.length ?? 0} 张试卷和错题会一起删掉，删了就找不回来了。</span>
        <Button variant="danger" onClick={async () => { if (deleting) await deleteFolder(deleting.id); setDeleting(null); toast("已删除"); setFolders(await listFolders()); }}>删除</Button>
        <Button variant="plain" onClick={() => setDeleting(null)}>取消</Button>
      </Sheet>

      {add.sheet}
    </div>
  );
}
