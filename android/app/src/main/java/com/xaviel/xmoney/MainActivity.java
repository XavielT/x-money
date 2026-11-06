package com.xaviel.xmoney;

import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShareReceiverPlugin.class);
        registerPlugin(NotificationCapturePlugin.class);
        super.onCreate(savedInstanceState);
        getBridge().addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageLoaded(WebView webView) {
                    dropStaleWebCache(webView);
                }
            }
        );
    }

    /**
     * The web app ships inside the APK, so a service worker's cached copy of it is only a risk: after an
     * update it can keep serving the previous version. Once per installed version the service worker
     * registrations and the caches are deleted and the page reloads from the APK. Nothing else is touched:
     * IndexedDB, localStorage and Preferences (the user's data and settings) are not part of this.
     */
    private void dropStaleWebCache(WebView webView) {
        String version;
        try {
            version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return;
        }
        SharedPreferences prefs = getSharedPreferences("xmoney_web", MODE_PRIVATE);
        if (version == null || version.equals(prefs.getString("webCacheClearedFor", null))) return;
        prefs.edit().putString("webCacheClearedFor", version).apply();
        webView.evaluateJavascript(
            "navigator.serviceWorker.getRegistrations()" +
            ".then(function(rs){return Promise.all(rs.map(function(r){return r.unregister();}));})" +
            ".then(function(){return caches.keys();})" +
            ".then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k);}));})" +
            ".then(function(){location.reload();},function(){});",
            null
        );
    }
}
