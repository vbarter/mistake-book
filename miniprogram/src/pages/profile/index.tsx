import { useEffect, useMemo } from "react";
import { Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { Icon } from "../../components/Icon";
import { Row, Stat, SubjectTile, TopBar } from "../../components/ui";
import { errorText } from "../../lib/api";
import { LOGIN_PAGE, currentUser, ensureLogin, isLoggedIn, loginLabel, refreshUser, updateProfile } from "../../lib/auth";
import { allErrors } from "../../lib/errors";
import { GRADE_LABEL } from "../../lib/format";
import { toast, useDataVersion, useTabBar } from "../../lib/hooks";
import { C } from "../../lib/theme";
import { listFolders, photosSizeMB } from "../../lib/store";
import { useShare, useShareTimelineToo } from "../../lib/share";

/** 小程序版本：三位 */
const VERSION = "1.8.13";

/** 我的：和 App 的「我的」同一套布局——账号卡片、统计、学习设置、数据与隐私、关于。没登录也能看，账号卡片换成「点这里登录」 */
export default function Profile() {
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

  return (
    <View className="page page--tab" style={{ gap: "14px", paddingTop: 0 }}>
      <TopBar />
      <View className="card card--row profile-card" hoverClass="card--pressed" onClick={editName}>
        <View className="avatar-wrap">
          <View className="avatar">{user ? user.nickname.slice(-1) : <Icon name="person" size={26} color="#ffffff" stroke={2} />}</View>
          {gradeShort && <Text className="avatar__badge">{gradeShort}</Text>}
        </View>
        <View className="flex1 col gap4 minw0">
          <Text className="t-title3 b ellipsis">{user ? user.nickname : "未登录"}</Text>
          {user && (
            <View className="row-center gap4">
              <Icon name="pin" size={13} color={C.secondary} stroke={2.2} />
              <Text className="t-foot c-sec">{[city, grade].filter(Boolean).join(" · ")}</Text>
            </View>
          )}
          {!user ? (
            <Text className="t-cap c-sec">点这里登录，登录后可以扫描试卷、导出错题本</Text>
          ) : (
          <View className="row-center gap4">
            <Icon name={guest ? "info" : "checkcircle"} size={12} color={guest ? C.secondary : C.ok} stroke={2.6} />
            <Text className={`t-cap ${guest ? "c-sec" : "c-ok"}`}>{guest ? "游客，建议用微信登录" : `${loginLabel(user.loginMethod)}账号已登录`}</Text>
          </View>
          )}
        </View>
        <Icon name="chevron-right" size={16} color={C.tertiary} stroke={2.4} />
      </View>

      <View className="stats">
        <Stat center label="张试卷" value={stats.papers} />
        <Stat center label="道答错" value={stats.wrong} color={C.wrong} />
        <Stat center label="道未作答" value={stats.blank} />
      </View>

      <View className="col">
        <Text className="group-title">学习设置</Text>
        <View className="group">
          <Row icon="graduation" iconBg={C.brand} title="年级与城市" value={[grade || "未设置年级", city].filter(Boolean).join(" · ")} onClick={() => goLoggedIn("/pages/settings/index", "修改年级")} />
          <Row
            icon="books"
            iconBg={C.brand}
            title="学科"
            value={
              // 最多露 3 个学科图标，其余用「+N」收起
              <View className="row-center gap4">
                {(user?.subjects ?? []).slice(0, 3).map((s) => (
                  <SubjectTile key={s} subject={s} size="xs" />
                ))}
                {(user?.subjects.length ?? 0) > 3 && <Text className="t-foot c-sec">+{user!.subjects.length - 3}</Text>}
                {!user?.subjects.length && <Text className="t-foot c-sec">未选</Text>}
              </View>
            }
            onClick={() => goLoggedIn("/pages/settings/index", "修改学科")}
          />
        </View>
        <Text className="group-note">年级和城市决定错题按哪套考纲归类知识点；试卷上能看出来的以试卷为准。</Text>
      </View>

      <View className="col">
        <Text className="group-title">数据与隐私</Text>
        <View className="group">
          <Row icon="export" iconBg={C.brand} title="我的导出" value="最近 7 天" onClick={() => goLoggedIn("/pages/exports/index", "查看导出")} />
          <Row icon="photo" iconBg={C.accentOn} title="本机试卷照片" value={`${stats.papers} 张 · ${stats.mb} MB`} chevron={false} />
          <Row icon="shield" iconBg={C.ok} title="隐私与权限" onClick={() => go("/pages/privacy/index")} />
          {user ? (
            <Row icon="person" iconBg={C.label} title="账号与登录" value={loginLabel(user.loginMethod)} onClick={() => go("/pages/account/index")} />
          ) : (
            <Row icon="person" iconBg={C.label} title="登录" value="微信一键登录" onClick={() => go(LOGIN_PAGE)} />
          )}
        </View>
        <Text className="group-note">试卷照片和电子版只保存在这台手机上，不上传；导出的 PDF 在服务器上保留 7 天。</Text>
      </View>

      <View className="group">
        <Row icon="info" iconBg={C.secondary} title="关于错误本" value={VERSION} chevron={false} />
      </View>
    </View>
  );
}
