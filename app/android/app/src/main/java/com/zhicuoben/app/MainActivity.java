package com.zhicuoben.app;

import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "Zhicuoben";
    /** 两次渲染进程被杀间隔太短就不再重建，避免一直崩一直重启 */
    private static final long MIN_RESTART_INTERVAL_MS = 15_000;
    private static long lastRenderGoneAt = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 网页渲染进程被系统回收（内存紧张时国产 ROM 很常见）或崩溃时，WebView 默认会把整个 App 一起带走。
        // 这里接住：丢掉死掉的 WebView，重建页面。网页数据都在 IndexedDB 里，重开后还在。
        bridge.addWebViewListener(
            new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                    // 这个回调只在安卓 8.0（API 26）及以上才会被调用
                    boolean crashed = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail != null && detail.didCrash();
                    Log.w(TAG, "WebView render process gone, crashed=" + crashed);
                    long now = SystemClock.elapsedRealtime();
                    boolean tooSoon = lastRenderGoneAt != 0 && now - lastRenderGoneAt < MIN_RESTART_INTERVAL_MS;
                    lastRenderGoneAt = now;
                    if (webView.getParent() instanceof ViewGroup) {
                        ((ViewGroup) webView.getParent()).removeView(webView);
                    }
                    webView.destroy();
                    if (isFinishing() || isDestroyed()) return true;
                    if (tooSoon) finish();
                    else recreate();
                    return true;
                }
            }
        );
    }
}
