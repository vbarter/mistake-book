import { useState } from "react";
import { Input, Picker, Text, View } from "@tarojs/components";
import Taro, { useUnload } from "@tarojs/taro";
import { errorText } from "../../lib/api";
import { LOGIN_CLOSED_EVENT, login } from "../../lib/auth";
import { startJobPoller } from "../../lib/jobs";
import { GRADE_LABEL, SUBJECTS, SUBJECT_LABEL } from "../../lib/format";
import type { Subject } from "../../lib/types";
import { SubjectTile } from "../../components/ui";
import "./index.scss";
import { useShare } from "../../lib/share";

const GRADES = Object.keys(GRADE_LABEL);

/** 回到打开登录页之前的页面；直接打开登录页（没有上一页）时去首页 */
function leave() {
  if (Taro.getCurrentPages().length > 1) void Taro.navigateBack();
  else void Taro.switchTab({ url: "/pages/home/index" });
}

/**
 * 登录：选年级和学科（决定知识点按哪套考纲归类），微信一键登录。
 * 只在用户要扫描、导出等操作时打开（lib/auth 的 ensureLogin），随时可以「暂不登录」回去接着看。
 */
export default function Login() {
  useShare();
  const [grade, setGrade] = useState("7");
  const [subjects, setSubjects] = useState<Subject[]>(["math", "chinese", "english"]);
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);

  useUnload(() => Taro.eventCenter.trigger(LOGIN_CLOSED_EVENT));

  const toggle = (s: Subject) => setSubjects((v) => (v.includes(s) ? v.filter((x) => x !== s) : [...v, s]));

  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await login({ grade, subjects, nickname: nickname.trim() || undefined });
      startJobPoller();
      leave();
    } catch (e) {
      void Taro.showModal({ title: "登录失败", content: errorText(e), showCancel: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="page login">
      <View className="login__hero">
        <Text className="login__logo">错</Text>
        <Text className="t-title1 b">错误本</Text>
        <Text className="t-sub c-sec">拍下试卷，自动找出错题，按知识点归类</Text>
      </View>

      <View className="card">
        <Text className="t-headline">年级</Text>
        <Picker mode="selector" range={GRADES.map((g) => GRADE_LABEL[g])} value={GRADES.indexOf(grade)} onChange={(e) => setGrade(GRADES[Number(e.detail.value)])}>
          <View className="field">
            <Text>{GRADE_LABEL[grade]}</Text>
            <Text className="c-ter">›</Text>
          </View>
        </Picker>
        <Text className="t-headline">学科</Text>
        <View className="row-wrap">
          {SUBJECTS.map((s) => (
            <View key={s} className={`chip${subjects.includes(s) ? " chip--on" : ""}`} onClick={() => toggle(s)}>
              <SubjectTile subject={s} size="xs" />
              <Text>{SUBJECT_LABEL[s]}</Text>
            </View>
          ))}
        </View>
        <Text className="t-headline">怎么称呼你（可不填）</Text>
        <Input className="input" value={nickname} maxlength={16} placeholder="昵称" onInput={(e) => setNickname(e.detail.value)} />
      </View>

      <View className={`btn btn--wx${busy ? " btn--disabled" : ""}`} onClick={go}>
        {busy ? "登录中…" : "微信一键登录"}
      </View>
      <Text className="t-sub c-brand center" onClick={leave}>
        暂不登录，先看看
      </Text>
      <Text className="t-cap c-sec center">登录后试卷和错题会保存到云端，同一个微信在别的手机、电脑上也能看到；绑定手机号后，在知错本 App 里也能看到。</Text>
    </View>
  );
}
