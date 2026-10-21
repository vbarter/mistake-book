import { useNavigate } from "react-router-dom";
import { Icon, type IconName } from "../components/Icon";
import { Button } from "../components/ui";

const features: { icon: IconName; title: string; text: string }[] = [
  { icon: "sparkles", title: "拍一拍就整理好", text: "自动框出错题、识别题目、归到知识点" },
  { icon: "clock", title: "该复习时提醒你", text: "按遗忘曲线安排，每天几分钟" },
  { icon: "pencil", title: "练一题，会一类", text: "同类变式题，连续答对就算掌握" },
];

export default function Welcome() {
  const nav = useNavigate();
  return (
    <div className="screen screen--card">
      <div className="screen__content screen__content--modal" style={{ padding: "calc(var(--safe-top) + 48px) 24px calc(var(--safe-bottom) + 24px)", gap: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, paddingTop: 16 }}>
          <div style={{ width: 96, height: 96, borderRadius: 26, background: "var(--brand)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
            <Icon name="camera" size={52} />
          </div>
          <h1 className="t-large">知错本</h1>
          <p className="t-body c-sec" style={{ textAlign: "center" }}>
            拍下试卷，错题自动整理，
            <br />
            到时间提醒你复习。
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {features.map((f) => (
            <div key={f.title} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <span style={{ width: 44, height: 44, borderRadius: 12, background: "var(--brand-tint)", color: "var(--brand)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon name={f.icon} size={24} />
              </span>
              <div>
                <div className="t-headline">{f.title}</div>
                <div className="t-sub c-sec">{f.text}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          <Button onClick={() => nav("/setup")}>开始使用</Button>
          <Button variant="tinted" onClick={() => nav("/login")} style={{ height: 44 }}>
            已有账号，登录
          </Button>
          <p className="t-cap c-sec" style={{ textAlign: "center" }}>
            继续即表示同意 <a href="#terms">用户协议</a> 与 <a href="#privacy">隐私政策</a>
          </p>
        </div>
      </div>
    </div>
  );
}
