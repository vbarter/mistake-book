import { useEffect, useState } from "react";
import { View, WebView } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { Busy } from "../../components/plan";
import { errorText } from "../../lib/api";
import { toast } from "../../lib/hooks";
import { deliverPicked, pickPageUrl, type PickedFile } from "../../lib/plans";

/**
 * 选手机里的文件：整页是一个 web-view，里面是服务器的选文件网页（小程序自己的接口读不到手机目录，只有网页能打开系统的文件选择器）。
 * 网页里选好、传完，点「完成」时把凭证发回来并返回上一页；消息在返回的那一刻才送到，所以这里收到就直接交给新建页。
 * 需要在小程序后台把接口域名加进「业务域名」，否则微信不让打开网页。
 */
export default function PlanPick() {
  const [url, setUrl] = useState("");

  useEffect(() => {
    pickPageUrl()
      .then(setUrl)
      .catch((e) => {
        toast(errorText(e));
        setTimeout(() => void Taro.navigateBack(), 1200);
      });
  }, []);

  if (!url)
    return (
      <View className="page">
        <Busy text="正在打开" />
      </View>
    );
  return (
    <WebView
      src={url}
      onMessage={(e) => {
        const all = (e.detail.data || []) as { files?: PickedFile[] }[];
        const last = all[all.length - 1];
        if (last?.files?.length) deliverPicked(last.files);
      }}
    />
  );
}
