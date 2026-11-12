import { useMemo } from "react";
import { Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { Row } from "../../components/ui";
import { toast, useDataVersion } from "../../lib/hooks";
import { clearAllFolders, listFolders } from "../../lib/store";
import { useShare } from "../../lib/share";
import { useThemeClass } from "../../lib/theme";

/** 隐私与数据（和 App 的同名页面一致），底部可以清空本应用数据 */
export default function Privacy() {
  const tc = useThemeClass();
  useShare();
  const [version, refresh] = useDataVersion();
  const folders = useMemo(() => listFolders(), [version]);
  const papers = folders.reduce((n, f) => n + f.papers.length, 0);

  const clear = async () => {
    const m = await Taro.showModal({
      title: "清空本应用数据？",
      content: `会删掉 ${folders.length} 个文件夹、${papers} 张试卷，以及它们的照片、电子版和错题，不能恢复。已登录时云端和你其他设备上的也会一起删掉。账号和学习设置不受影响。`,
      confirmText: "清空",
      confirmColor: "#b42323",
    });
    if (!m.confirm) return;
    clearAllFolders();
    refresh();
    toast("已清空", "success");
  };

  const card = (title: string, text: string) => (
    <View className="card">
      <Text className="t-headline">{title}</Text>
      <Text className="t-sub c-sec">{text}</Text>
    </View>
  );

  return (
    <View className={"page" + tc}>
      {card("我们收集什么", "账号保存昵称、年级、学科设置、登录方式和你绑定的手机号。登录后，试卷照片、电子版和错题会同步保存到我们在腾讯云（上海）的服务器，用于在你的其他手机、电脑上查看；照片加密存储，只有你的账号能访问。不收集姓名、学校、班级、位置。")}
      {card("扫描时如何处理照片", "扫描时把试卷照片发到我们的服务器识别和批改，并要求 AI 忽略姓名、学校、班级等信息。识别用的临时文件保留一天后自动删除；登录后试卷照片和识别结果另按上面的方式同步保存。")}
      {card("第三方 SDK", "不接入任何广告或分析 SDK。")}
      {card("你的权利", "随时可以在下面清空全部试卷和错题，云端的会一起删除；注销账号时云端数据全部删除。清空后不能恢复，账号和学习设置不受影响。")}
      <View className="group">
        <Row icon="trash" iconBg="#5b5b63" title="清空本应用数据" value={`${papers} 张试卷`} onClick={clear} />
      </View>
    </View>
  );
}
