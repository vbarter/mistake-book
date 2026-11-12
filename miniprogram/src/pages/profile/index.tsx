import { useEffect, useMemo, useState } from "react";
import { Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { AvatarSheet } from "../../components/AvatarPrompt";
import { Icon } from "../../components/Icon";
import { Avatar, Row, Sheet, Stat, SubjectTile, TopBar } from "../../components/ui";
import { errorText } from "../../lib/api";
import { LOGIN_PAGE, currentUser, ensureLogin, isLoggedIn, loginLabel, refreshUser, updateProfile } from "../../lib/auth";
import { allErrors } from "../../lib/errors";
import { GRADE_LABEL } from "../../lib/format";
import { toast, useDataVersion, useTabBar } from "../../lib/hooks";
import { C, THEMES, setTheme, useTheme, useThemeClass } from "../../lib/theme";
import { ColorIcon } from "../../components/ColorIcon";
import { listFolders, photosSizeMB } from "../../lib/store";
import { useShare, useShareTimelineToo } from "../../lib/share";

/** 小程序版本：三位 */
const VERSION = "1.12.26";

/** 我的：和 App 的「我的」同一套布局——账号卡片、统计、学习设置、数据与隐私、关于。没登录也能看，账号卡片换成「登录」。只留图标和短标题，不放解释性的段落 */
export default function Profile() {
  const tc = useThemeClass();
  useShare();
  useShareTimelineToo();
  useTabBar(3);
  const [version, refresh] = useDataVersion();
  const user = useMemo(() => (isLoggedIn() ? currentUser() : null), [version]);
  const folders = useMemo(() => listFolders(), [version]);
  const city = useMemo(() => (Taro.getStorageSync("zcb.city") as string) || "", [version]);

  useEffect(() => {
    if (isLoggedIn()) void refreshUser().then(() => refresh());
  }, []);

  const stats = useMemo(() => {
    const errors = allErrors(folders);
    return {
      papers: folders.reduce((n, f) => n + f.papers.length, 0),
      wrong: errors.filter((e) => e.kind !== "未作答").length,
      blank: errors.filter((e) => e.kind === "未作答").length,
      mb: photosSizeMB(folders),
    };
  }, [folders]);

  // 年级为空 = 没设过（服务端按卷面年级或题目内容判断）
  const grade = user?.grade ? GRADE_LABEL[user.grade] ?? `${user.grade} 年级` : "";
  const g = Number(user?.grade);
  const gradeShort = !grade ? "" : g >= 10 ? grade : g >= 7 ? `初${"一二三"[g - 7]}` : grade.replace("年级", "");
  const guest = user?.loginMethod === "guest";
  const go = (url: string) => Taro.navigateTo({ url });
  // 改设置、看导出都在服务器上：没登录先登录
  const goLoggedIn = async (url: string, what: string) => {
    if (await ensureLogin(what)) go(url);
  };

  const editName = async () => {
    if (!user) return go(LOGIN_PAGE);
    const m = await Taro.showModal({ title: "怎么称呼你", editable: true, content: user.nickname });
    if (!m.confirm || !m.content?.trim()) return;
    try {
      await updateProfile({ nickname: m.content.trim().slice(0, 16) });
      refresh();
      toast("已更新", "success");
    } catch (e) {
      toast(errorText(e));
    }
  };

  const [avatarOpen, setAvatarOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const theme = useTheme();

  return (
    <View className={"page page--tab" + tc} style={{ gap: "14px", paddingTop: 0 }}>
      <TopBar />
      <View className="card card--row profile-card" hoverClass="card--pressed" onClick={editName}>
        <View className="avatar-wrap">
          {user ? (
            // 点头像先弹自己的面板（用微信头像 / 从相册选）：原生的选头像按钮被微信禁用时点了没有任何反应，不能直接盖在头像上
            <View className="avatar-btn" onClick={(e) => (e.stopPropagation(), setAvatarOpen(true))}>
              <Avatar name={user.nickname} url={user.avatar} size={60} />
              <View className="avatar__cam">
                <Icon name="camera" size={11} color="#ffffff" stroke={2.4} />
              </View>
            </View>
          ) : (
            <View className="avatar">
              <Icon name="person" size={26} color="#ffffff" stroke={2} />
            </View>
          )}
          {gradeShort && <Text className="avatar__badge">{gradeShort}</Text>}
        </View>
        <View className="flex1 col gap4 minw0">
          <View className="row-center gap6 minw0">
            <Text className="t-title3 b ellipsis">{user ? user.nickname : "登录"}</Text>
            {guest && <Text className="pill-mute">游客</Text>}
          </View>
          {user && (city || grade) && (
            <View className="row-center gap4">
              <Icon name="pin" size={13} color={C.secondary} stroke={2.2} />
              <Text className="t-foot c-sec">{[city, grade].filter(Boolean).join(" · ")}</Text>
            </View>
          )}
        </View>
        <Icon name="chevron-right" size={16} color={C.tertiary} stroke={2.4} />
      </View>

      <View className="stats">
        <Stat icon="document" label="试卷" value={stats.papers} />
        <Stat icon="xcircle" label="答错" value={stats.wrong} color={C.wrong} />
        <Stat icon="minus" label="未答" value={stats.blank} />
      </View>

      <View className="group">
        <Row art="grade" title="年级" value={[grade, city].filter(Boolean).join(" · ")} onClick={() => goLoggedIn("/pages/settings/index", "修改年级")} />
        <Row
          art="folder"
          title="学科"
          value={
            // 最多露 3 个学科图标，其余用「+N」收起
            <View className="row-center gap4">
              {(user?.subjects ?? []).slice(0, 3).map((s) => (
                <SubjectTile key={s} subject={s} size="xs" />
              ))}
              {(user?.subjects.length ?? 0) > 3 && <Text className="t-foot c-sec">+{user!.subjects.length - 3}</Text>}
            </View>
          }
          onClick={() => goLoggedIn("/pages/settings/index", "修改学科")}
        />
      </View>

      <View className="group">
        <Row art="export" title="导出" onClick={() => goLoggedIn("/pages/exports/index", "查看导出")} />
        <Row art="album" title="照片" value={`${stats.mb} MB`} chevron={false} />
        <Row art="privacy" title="隐私" onClick={() => go("/pages/privacy/index")} />
        {user ? (
          <Row art="account" title="账号" value={guest ? "" : loginLabel(user.loginMethod)} onClick={() => go("/pages/account/index")} />
        ) : (
          <Row art="account" title="登录" onClick={() => go(LOGIN_PAGE)} />
        )}
      </View>

      <View className="group">
        <Row art="settings" title="主题" value={THEMES.find((t) => t.id === theme)?.name} onClick={() => setThemeOpen(true)} />
        <Row art="service" title="客服" contact sessionFrom={`profile|${user?.id ?? "guest"}|${VERSION}`} />
        <Row art="about" title="关于" value={VERSION} chevron={false} />
      </View>
      {user && <AvatarSheet open={avatarOpen} user={user} onClose={() => setAvatarOpen(false)} />}
      <Sheet open={themeOpen} onClose={() => setThemeOpen(false)} title="主题">
        <View className="theme-grid">
          {THEMES.map((t) => (
            <View key={t.id} className={`theme-opt${theme === t.id ? " theme-opt--on" : ""}`} hoverClass="h4--hover" onClick={() => setTheme(t.id)}>
              <View className="theme-opt__art" style={{ background: t.swatch }}>
                {(["collect", "plan", "star"] as const).map((n) => (
                  <View key={n} className="theme-opt__icon">
                    <ColorIcon name={n} theme={t.id} size={34} />
                  </View>
                ))}
              </View>
              <View className="theme-opt__name">
                <Text>{t.name}</Text>
                {theme === t.id && <Icon name="checkcircle" size={18} color={C.brand} stroke={2.4} />}
              </View>
              <Text className="theme-opt__note">{t.note}</Text>
            </View>
          ))}
        </View>
      </Sheet>
    </View>
  );
}
