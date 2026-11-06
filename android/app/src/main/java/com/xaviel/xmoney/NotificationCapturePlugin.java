package com.xaviel.xmoney;

import android.content.Intent;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;

/**
 * Bridge between the web layer and the bank-notification inbox (BankNotificationStore).
 * The web layer pulls items with getPending(), makes drafts from them and removes them with ack(ids);
 * "bankNotification" is fired when a new one arrives while the app is open.
 */
@CapacitorPlugin(name = "NotificationCapture")
public class NotificationCapturePlugin extends Plugin {

    @Override
    public void load() {
        BankNotificationStore.setOnAdded(() -> notifyListeners("bankNotification", new JSObject()));
    }

    @Override
    protected void handleOnDestroy() {
        BankNotificationStore.setOnAdded(null);
        super.handleOnDestroy();
    }

    private boolean accessGranted() {
        return NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName());
    }

    /** enabled: the user's switch in the app; granted: Android's "Notification access" for X Money. */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("enabled", BankNotificationStore.isEnabled(getContext()));
        result.put("granted", accessGranted());
        call.resolve(result);
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        BankNotificationStore.setEnabled(getContext(), Boolean.TRUE.equals(call.getBoolean("enabled", false)));
        status(call);
    }

    /** Opens Android's "Notification access" screen, where only the user can grant it. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (RuntimeException e) {
            call.reject("settings-unavailable");
        }
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        JSArray items = new JSArray();
        JSONArray stored = BankNotificationStore.pending(getContext());
        for (int i = 0; i < stored.length(); i++) items.put(stored.opt(i));
        JSObject result = new JSObject();
        result.put("items", items);
        call.resolve(result);
    }

    @PluginMethod
    public void ack(PluginCall call) {
        Set<String> ids = new HashSet<>();
        JSArray raw = call.getArray("ids");
        if (raw != null) {
            for (int i = 0; i < raw.length(); i++) {
                try {
                    ids.add(raw.getString(i));
                } catch (JSONException ignored) {
                    // a malformed id removes nothing
                }
            }
        }
        BankNotificationStore.ack(getContext(), ids);
        call.resolve();
    }
}
