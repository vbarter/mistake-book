import { useNavigate } from "react-router-dom";
import { Icon, type IconName } from "../components/Icon";
import { Buddy } from "../components/Illustration";
import { Button } from "../components/ui";

const features: { icon: IconName; title: string; text: string }[] = [
  { icon: "camera", title: "拍一拍就整理好", text: "拍照或相册批量导入，自动识别归档" },
  { icon: "chart", title: "错题榜，一眼看到弱项", text: "最近最易错的题和知识点，按名次排好" },
  { icon: "printer", title: "一键导出错题本", text: "带目录的 PDF，打印出来重做" },
];

export default function Welcome() {
  const nav = useNavigate();
  return (
    <div className="screen screen--card screen--narrow">
      <div className="screen__content screen__content--modal" style={{ paddingTop: "calc(var(--safe-top) + 48px)", paddingLeft: 24, paddingRight: 24, paddingBottom: "calc(var(--safe-bottom) + 24px)", gap: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, paddingTop: 16 }}>
          <Buddy scene="hero" size={148} />
          <h1 className="t-large">知错本</h1>
          <p className="t-body c-sec" style={{ textAlign: "center" }}>
            拍下试卷，错题自动整理，
            <br />
            每一次订正，都是进步。
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {features.map((f) => (
            <div key={f.title} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <span style={{ width: 44, height: 44, borderRadius: 12, background: "var(--brand-gradient)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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
          <Button onClick={() => nav("/register")}>手机号注册</Button>
          <Button variant="tinted" onClick={() => nav("/login")}>
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
