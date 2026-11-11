import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Button, Row, Sheet } from "../components/ui";
import { Avatar, SubjectTile } from "../components/v2";
import { pickAvatar } from "../lib/native";
import { allErrors } from "../lib/errors";
import { listFolders, photoBytes, type Folder } from "../lib/folders";
import { GRADE_LABEL } from "../lib/format";
import { getCity } from "../lib/prefs";
import { WEB_VERSION, appVersion } from "../lib/version";
import { useAuth } from "../store/auth";
import { toast, toastError } from "../store/banner";


/** 我的：账号、年级与城市（决定知识点按哪套考纲归类）、学科、本机数据与隐私、关于。只留图标和短标题，解释性的话放到各自的子页里。 */
export default function Profile() {
  const nav = useNavigate();
  const { user, updateProfile, uploadAvatar } = useAuth();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [bytes, setBytes] = useState(0);
  const [city, setCityState] = useState("");
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState(user?.nickname ?? "");

  const [version, setVersion] = useState(WEB_VERSION);
  useEffect(() => {
    listFolders().then(setFolders).catch(() => setFolders([]));
    photoBytes().then(setBytes).catch(() => setBytes(0));
    getCity().then(setCityState);
    appVersion().then(setVersion);
  }, []);

  const stats = useMemo(() => {
    const errors = allErrors(folders);
    const papers = folders.reduce((n, f) => n + f.papers.length, 0);
    return { papers, wrong: errors.filter((e) => e.kind !== "未作答").length, blank: errors.filter((e) => e.kind === "未作答").length, mb: Math.round(bytes / 1048576) };
  }, [folders, bytes]);

  if (!user) return null;
  // 年级为空 = 注册后没设过（服务端按卷面年级或题目内容判断）
  const grade = user.grade ? GRADE_LABEL[user.grade] ?? `${user.grade} 年级` : "";
  const gradeShort = !grade ? "" : Number(user.grade) >= 10 ? grade : Number(user.grade) >= 7 ? `初${"一二三"[Number(user.grade) - 7]}` : grade.replace("年级", "");

  const saveName = async () => {
    try {
      await updateProfile({ nickname: name });
      setEditName(false);
      toast("已更新", "success");
    } catch (e) {
      toastError(e);
    }
  };

  const changeAvatar = async () => {
    try {
      const image = await pickAvatar();
      if (!image) return;
      await uploadAvatar(image);
      toast("头像换好了", "success");
    } catch (e) {
      if ((e as Error).message === "permission_denied") toast("需要相册权限，请在系统设置里打开");
      else toastError(e);
    }
  };

  return (
    <div className="screen">
      <div className="screen__content" style={{ gap: 14, paddingTop: "calc(var(--safe-top) + 16px)" }}>
        <button className="card card--row" style={{ padding: 16 }} onClick={() => { setName(user.nickname); setEditName(true); }}>
          <span style={{ position: "relative", flexShrink: 0 }}>
            {/* 点头像换头像（外层整张卡片是改名字的按钮，这里不再往外传） */}
            <span role="button" tabIndex={0} aria-label="换头像" style={{ display: "block", position: "relative" }} onClick={(e) => { e.stopPropagation(); void changeAvatar(); }}>
              <Avatar name={user.nickname} url={user.avatar} size={60} />
              <span aria-hidden="true" style={{ position: "absolute", left: -2, bottom: -2, width: 20, height: 20, borderRadius: 10, background: "rgba(0,0,0,.55)", border: "2px solid var(--card)", boxSizing: "border-box", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="camera" size={11} stroke={2.4} /></span>
            </span>
            {gradeShort && <span style={{ position: "absolute", right: -4, bottom: -2, fontSize: 10, fontWeight: 800, color: "#fff", background: "var(--brand)", border: "2px solid var(--card)", borderRadius: 9, padding: "1px 6px" }}>{gradeShort}</span>}
          </span>
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span className="t-title3 ellipsis" style={{ fontWeight: 800 }}>{user.nickname}</span>
              {user.loginMethod === "guest" && <span className="pill-mute">游客</span>}
            </span>
            {(city || grade) && <span className="t-foot c-sec" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="pin" size={13} stroke={2.2} />{[city, grade].filter(Boolean).join(" · ")}</span>}
          </span>
          <Icon name="chevron-right" size={16} stroke={2.4} style={{ color: "var(--tertiary)" }} />
        </button>

        <div className="stats">
          <div className="stat"><span className="stat__label"><Icon name="document" size={13} stroke={2.4} />试卷</span><span className="stat__value num">{stats.papers}</span></div>
          <div className="stat"><span className="stat__label" style={{ color: "var(--wrong)" }}><Icon name="xcircle" size={13} stroke={2.4} />答错</span><span className="stat__value num" style={{ color: "var(--wrong)" }}>{stats.wrong}</span></div>
          <div className="stat"><span className="stat__label"><Icon name="minus" size={13} stroke={2.4} />未答</span><span className="stat__value num">{stats.blank}</span></div>
        </div>

        <div className="group">
          <Row icon="graduation" iconColor="var(--brand)" title="年级" value={[grade, city].filter(Boolean).join(" · ")} onClick={() => nav("/profile/subjects")} />
          <Row icon="books" iconColor="var(--brand)" title="学科" value={
            // 最多露 3 个学科图标，其余用「+N」收起，免得学科多时把一行挤满
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {user.subjects.slice(0, 3).map((s) => <SubjectTile key={s} subject={s} size="xs" />)}
              {user.subjects.length > 3 && <span className="t-foot c-sec" style={{ marginLeft: 2 }}>+{user.subjects.length - 3}</span>}
            </span>
          } onClick={() => nav("/profile/subjects")} />
        </div>

        <div className="group">
          <Row icon="export" iconColor="var(--brand)" title="导出" onClick={() => nav("/profile/exports")} />
          <Row icon="photo" iconColor="var(--accent-on)" title="照片" value={`${stats.mb} MB`} chevron={false} />
          <Row icon="shield" iconColor="var(--mastered)" title="隐私" onClick={() => nav("/profile/privacy")} />
          <Row icon="person" iconColor="var(--label)" title="账号" value={user.loginMethod === "apple" ? "Apple" : user.loginMethod === "phone" ? "手机号" : ""} onClick={() => nav("/profile/account")} />
        </div>

        <div className="group">
          <Row icon="info" iconColor="var(--secondary)" title="关于" value={version} chevron={false} />
        </div>
      </div>

      <Sheet open={editName} onClose={() => setEditName(false)} title="怎么称呼你">
        <input className="input" autoFocus value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
        <Button onClick={saveName} disabled={!name.trim()}>保存</Button>
      </Sheet>
    </div>
  );
}
