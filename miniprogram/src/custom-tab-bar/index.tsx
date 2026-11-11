import { Component } from "react";
import Taro from "@tarojs/taro";
import { Text, View } from "@tarojs/components";
import { Icon, type IconName } from "../components/Icon";
import { captureInto, type Source } from "../lib/capture";
import { toast } from "../lib/hooks";
import { C } from "../lib/theme";
import "./index.scss";

/** 和 app.config 里 tabBar.list 的顺序一致 */
export const TABS: { path: string; label: string; icon: IconName }[] = [
  { path: "pages/home/index", label: "首页", icon: "house" },
  { path: "pages/papers/index", label: "试卷", icon: "folder" },
  { path: "pages/rank/index", label: "分析", icon: "chart" },
  { path: "pages/profile/index", label: "我的", icon: "person" },
];

function currentIndex(): number {
  const route = Taro.getCurrentPages().slice(-1)[0]?.route ?? "";
  return Math.max(0, TABS.findIndex((t) => t.path === route));
}

interface State {
  selected: number;
  open: boolean;
  hidden: boolean;
}

/**
 * 底部导航（和 App 的 TabBar 一样）：首页 / 试卷 / 中间凸起的相机键 / 分析 / 我的。
 * 相机键点一下弹出「拍照 / 相册导入」两个气泡，再点或点空白收起。
 * 每个 Tab 页各有一个实例，页面显示时用 setSelected 告诉它高亮哪个（lib/hooks 的 useTabBar）。
 */
export default class CustomTabBar extends Component<object, State> {
  state: State = { selected: currentIndex(), open: false, hidden: false };

  setSelected(selected: number) {
    this.setState({ selected, open: false });
  }

  /** 页面弹出底部面板时把 Tab 栏藏起来，免得盖住面板最下面的按钮（components/ui 的 Sheet 调用） */
  setHidden(hidden: boolean) {
    this.setState({ hidden, open: false });
  }

  go = (i: number) => {
    this.setState({ open: false });
    if (i === this.state.selected) {
      void Taro.pageScrollTo({ scrollTop: 0, duration: 250 });
      return;
    }
    void Taro.switchTab({ url: `/${TABS[i].path}` });
  };

  toggle = () => {
    void Taro.vibrateShort({ type: "light" }).catch(() => undefined);
    this.setState((s) => ({ open: !s.open }));
  };

  add = async (source: Source) => {
    this.setState({ open: false });
    try {
      const fid = await captureInto(null, source);
      if (fid) void Taro.navigateTo({ url: `/pages/folder/index?id=${fid}` });
    } catch (e) {
      toast(String((e as Error).message || e));
    }
  };

  tab(i: number) {
    const t = TABS[i];
    const on = this.state.selected === i;
    return (
      <View key={t.path} className={`ctb-tab${on ? " ctb-tab--on" : ""}`} onClick={() => this.go(i)}>
        <View className="ctb-tab__icon">
          <Icon name={t.icon} size={26} color={on ? C.brand : C.secondary} fill={on} stroke={1.8} />
        </View>
        <Text className="ctb-tab__label">{t.label}</Text>
      </View>
    );
  }

  render() {
    const { open, hidden } = this.state;
    if (hidden) return null;
    return (
      <View className="ctb">
        {open && <View className="ctb-scrim" catchMove onClick={() => this.setState({ open: false })} />}
        <View className={`ctb-menu${open ? " ctb-menu--open" : ""}`}>
          <View className="ctb-bubble ctb-bubble--left" onClick={() => this.add("camera")}>
            <View className="ctb-bubble__icon">
              <Icon name="camera" size={24} color={C.brand} stroke={2} />
            </View>
            <Text>拍照</Text>
          </View>
          <View className="ctb-bubble ctb-bubble--right" onClick={() => this.add("album")}>
            <View className="ctb-bubble__icon">
              <Icon name="photo" size={24} color={C.brand} stroke={2} />
            </View>
            <Text>相册导入</Text>
          </View>
        </View>
        <View className="ctb-bar">
          {this.tab(0)}
          {this.tab(1)}
          <View className="ctb-tab ctb-tab--fab">
            <View className={`ctb-fab${open ? " ctb-fab--open" : ""}`} onClick={this.toggle}>
              <Icon name={open ? "plus" : "camera"} size={28} color="#ffffff" stroke={2.2} />
            </View>
          </View>
          {this.tab(2)}
          {this.tab(3)}
        </View>
      </View>
    );
  }
}
