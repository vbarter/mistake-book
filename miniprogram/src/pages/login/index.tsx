import { useState } from "react";
import { Input, Picker, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { errorText } from "../../lib/api";
import { login } from "../../lib/auth";
import { startJobPoller } from "../../lib/jobs";
import { GRADE_LABEL, SUBJECTS, SUBJECT_LABEL } from "../../lib/format";
import type { Subject } from "../../lib/types";
import { SubjectTile } from "../../components/ui";
import "./index.scss";

const GRADES = Object.keys(GRADE_LABEL);

/** 欢迎 + 登录：选年级和学科（决定知识点按哪套考纲归类），微信一键登录 */
export default function Login() {
  const [grade, setGrade] = useState("7");
  const [subjects, setSubjects] = useState<Subject[]>(["math", "chinese", "english"]);
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);

  const toggle = (s: Subject) => setSubjects((v) => (v.includes(s) ? v.filter((x) => x !== s) : [...v, s]));

  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await login({ grade, subjects, nickname: nickname.trim() || undefined });
      startJobPoller();
      Taro.switchTab({ url: "/pages/papers/index" });
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
      <Text className="t-cap c-sec center">试卷照片和电子版只保存在你的手机上。扫描时照片会发到服务器识别，识别完不保留。</Text>
    </View>
  );
}
