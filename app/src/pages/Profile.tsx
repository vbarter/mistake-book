import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Button, LargeNav, Row, Sheet } from "../components/ui";
import { SubjectTile } from "../components/v2";
import { allErrors } from "../lib/errors";
import { listFolders, type Folder } from "../lib/folders";
import { GRADE_LABEL, SUBJECT_LABEL } from "../lib/format";
import { getCity } from "../lib/prefs";
import { useAuth } from "../store/auth";
import { toast, toastError } from "../store/banner";

const BUILD = "1.0 (18)";

/** 我的：账号、年级与城市（决定知识点按哪套考纲归类）、学科、本机数据与隐私、关于。 */
export default function Profile() {
  const nav = useNavigate();
  const { user, updateProfile } = useAuth();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [city, setCityState] = useState("");
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState(user?.nickname ?? "");

  useEffect(() => {
    listFolders().then(setFolders).catch(() => setFolders([]));
    getCity().then(setCityState);
  }, []);

  const stats = useMemo(() => {
    const errors = allErrors(folders);
    const papers = folders.reduce((n, f) => n + f.papers.length, 0);
    const bytes = folders.reduce((n, f) => n + f.papers.reduce((m, p) => m + p.pages.reduce((k, pg) => k + pg.src.length * 0.75, 0), 0), 0);
    return { papers, wrong: errors.length, corrected: errors.filter((e) => e.corrected).length, mb: Math.round(bytes / 1048576) };
  }, [folders]);

  if (!user) return null;
  const grade = GRADE_LABEL[user.grade] ?? `${user.grade} 年级`;
  const gradeShort = Number(user.grade) >= 10 ? grade : Number(user.grade) >= 7 ? `初${"一二三"[Number(user.grade) - 7]}` : grade.replace("年级", "");

  const saveName = async () => {
    try {
      await updateProfile({ nickname: name });
      setEditName(false);
      toast("已更新", "success");
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="screen">
      <LargeNav title="我的" />
      <div className="screen__content" style={{ gap: 14, paddingTop: 6 }}>
        <button className="card card--row" style={{ padding: 16 }} onClick={() => { setName(user.nickname); setEditName(true); }}>
          <span style={{ position: "relative", flexShrink: 0 }}>
            <span aria-hidden="true" style={{ width: 60, height: 60, borderRadius: 30, background: "var(--avatar-bg)", color: "var(--avatar-fg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 800 }}>{user.nickname.slice(-1)}</span>
            <span style={{ position: "absolute", right: -4, bottom: -2, fontSize: 10, fontWeight: 800, color: "#fff", background: "var(--brand)", border: "2px solid var(--card)", borderRadius: 9, padding: "1px 6px" }}>{gradeShort}</span>
          </span>
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <span className="t-title3 ellipsis" style={{ fontWeight: 800 }}>{user.nickname}</span>
            <span className="t-foot c-sec" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="pin" size={13} stroke={2.2} />{[city, grade].filter(Boolean).join(" · ")}</span>
            <span className="t-cap" style={{ color: user.loginMethod === "guest" ? "var(--secondary)" : "var(--mastered)", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Icon name={user.loginMethod === "guest" ? "info" : "checkcircle"} size={12} stroke={2.6} />{user.loginMethod === "apple" ? "Apple 账号已绑定" : user.loginMethod === "phone" ? "手机号已绑定" : "游客，建议绑定账号"}
            </span>
          </span>
          <Icon name="chevron-right" size={16} stroke={2.4} style={{ color: "var(--tertiary)" }} />
        </button>

        <div className="stats">
          <div className="stat" style={{ alignItems: "center" }}><span className="stat__value num" style={{ color: "var(--brand)" }}>{stats.papers}</span><span className="stat__label">张试卷</span></div>
          <div className="stat" style={{ alignItems: "center" }}><span className="stat__value num" style={{ color: "var(--wrong)" }}>{stats.wrong}</span><span className="stat__label">道错题</span></div>
          <div className="stat" style={{ alignItems: "center" }}><span className="stat__value num" style={{ color: "var(--mastered)" }}>{stats.corrected}</span><span className="stat__label">已订正</span></div>
        </div>

        <div>
          <div className="group__header" style={{ padding: "0 12px 6px" }}><span>学习设置</span></div>
          <div className="group">
            <Row icon="graduation" iconColor="var(--brand)" title="年级与城市" value={[grade, city].filter(Boolean).join(" · ")} onClick={() => nav("/profile/subjects")} />
            <Row icon="letters" iconColor="var(--english)" title="学科" value={
              // 最多露 3 个学科图标，其余用「+N」收起，免得学科多时把一行挤满
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {user.subjects.slice(0, 3).map((s) => <SubjectTile key={s} subject={s} size="xs" />)}
                {user.subjects.length > 3 && <span className="t-foot c-sec" style={{ marginLeft: 2 }}>+{user.subjects.length - 3}</span>}
                {user.subjects.length === 0 && <span className="t-foot c-sec">未选</span>}
              </span>
            } onClick={() => nav("/profile/subjects")} />
          </div>
          <p className="t-cap c-sec" style={{ padding: "6px 12px 0" }}>年级和城市决定错题按哪套考纲归类知识点；试卷上能看出来的以试卷为准。</p>
        </div>

        <div>
          <div className="group__header" style={{ padding: "0 12px 6px" }}><span>数据与隐私</span></div>
          <div className="group">
            <Row icon="photo" iconColor="var(--accent-on)" title="本机试卷照片" value={`${stats.papers} 张 · ${stats.mb} MB`} chevron={false} />
            <Row icon="shield" iconColor="var(--mastered)" title="隐私与权限" onClick={() => nav("/profile/privacy")} />
            <Row icon="person" iconColor="var(--label)" title="账号与登录" value={user.loginMethod === "apple" ? "Apple" : user.loginMethod === "phone" ? "手机号" : "游客"} onClick={() => nav("/profile/account")} />
          </div>
          <p className="t-cap c-sec" style={{ padding: "6px 12px 0" }}>试卷照片和电子版只保存在这台设备上，不上传。</p>
        </div>

        <div className="group">
          <Row icon="info" iconColor="var(--secondary)" title="关于知错本" value={BUILD} chevron={false} />
        </div>
        <span className="t-cap c-sec" style={{ textAlign: "center" }}>{SUBJECT_LABEL.english}、{SUBJECT_LABEL.math}、{SUBJECT_LABEL.chinese}、{SUBJECT_LABEL.science} · 小学到高中</span>
      </div>

      <Sheet open={editName} onClose={() => setEditName(false)} title="怎么称呼你">
        <input className="input" autoFocus value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
        <Button onClick={saveName} disabled={!name.trim()}>保存</Button>
      </Sheet>
    </div>
  );
}
