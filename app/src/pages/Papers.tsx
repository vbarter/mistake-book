import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Button, Empty, LargeNav, Sheet } from "../components/ui";
import { deleteFolder, folderStatus, listFolders, validDigitized, type Folder } from "../lib/folders";
import { formatDate } from "../lib/format";
import { useCapture } from "../store/capture";

/** 试卷 Tab：所有录入过的试卷一目了然，点一下直达电子版或继续扫描；底部两个按钮一步开始录新试卷。 */
export default function Papers() {
  const nav = useNavigate();
  const { setFolder, setReturnTo, reset } = useCapture();
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Folder | null>(null);

  const refresh = () => listFolders().then((list) => setFolders([...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))).catch(() => setFolders([]));
  useEffect(() => {
    void refresh();
  }, []);

  const capture = (source: "camera" | "photos") => {
    reset();
    setReturnTo("/papers");
    nav("/capture", { state: { source } });
  };

  const open = (f: Folder) => {
    const digitized = validDigitized(f.digitized);
    setFolder(f.id, f.name, f.pages.map((p) => ({ ...p, boxes: p.boxes ?? [] })), digitized);
    setReturnTo("/papers");
    nav(digitized ? "/capture/paper" : "/capture");
  };

  return (
    <div className="screen">
      <LargeNav title="试卷" eyebrow={folders && folders.length ? `${folders.length} 份` : undefined} />
      <div className="screen__content" style={{ paddingBottom: 0 }}>
        {folders && folders.length === 0 && (
          <Empty icon="book" title="还没有录入试卷" text="拍下整页试卷或从相册多选，AI 会还原成电子版，找出错题并按知识点归类。" action={<Button size="xs" variant="plain" onClick={() => { reset(); setReturnTo("/papers"); nav("/capture", { state: { source: "sample" } }); }}>没有试卷？用示例试卷试试</Button>} />
        )}

        {folders && folders.length > 0 && (
          <div className="group">
            {folders.map((f) => {
              const st = folderStatus(f);
              return (
                <div key={f.id} className="row" style={{ minHeight: 72 }}>
                  <img src={f.pages[0]?.src} alt="" style={{ width: 44, height: 58, objectFit: "cover", borderRadius: 6, border: "1px solid var(--separator-light)" }} />
                  <button className="row__main" style={{ textAlign: "left", gap: 4 }} onClick={() => open(f)}>
                    <span className="row__title ellipsis">{f.name}</span>
                    <span className="row__sub" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span>{f.pages.length} 页 · {formatDate(f.updatedAt)}</span>
                      <span className="chip chip--sm" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                    </span>
                  </button>
                  <Icon name="chevron-right" size={18} style={{ color: "var(--tertiary)" }} />
                  <button className="icon-btn" style={{ color: "var(--tertiary)" }} aria-label={`删除「${f.name}」`} onClick={() => setConfirmDelete(f)}>
                    <Icon name="trash" size={19} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Tab 页里的底栏要浮在 Tab 栏之上 */}
        <div className="bottom-bar" style={{ marginTop: "auto", bottom: "calc(var(--tabbar-h) + var(--safe-bottom))", paddingBottom: 12 }}>
          <Button icon="camera" onClick={() => capture("camera")} style={{ flex: 1 }}>拍试卷</Button>
          <Button variant="tinted" icon="photo" onClick={() => capture("photos")} style={{ flex: 1 }}>从相册选</Button>
        </div>
      </div>

      <Sheet open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)} title={`删除「${confirmDelete?.name}」？`}>
        <p className="t-sub c-sec">只删除本机保存的 {confirmDelete?.pages.length} 页试卷图片和电子版，已收进错题本的题不受影响。</p>
        <Button variant="danger" onClick={async () => { if (confirmDelete) { await deleteFolder(confirmDelete.id); setConfirmDelete(null); void refresh(); } }}>删除</Button>
        <Button variant="plain" onClick={() => setConfirmDelete(null)}>取消</Button>
      </Sheet>
    </div>
  );
}
