package com.xaviel.xmoney;

import android.content.Context;
import android.content.SharedPreferences;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Device-only inbox of bank notifications. Nothing here touches the network: the web layer reads the
 * items, turns them into DRAFTS (never movements) and acknowledges them, which removes them.
 * Only the bank apps in BANK_PACKAGES are ever stored; every other notification is ignored.
 */
final class BankNotificationStore {

    // Popular, Banreservas, BHD (two apps). Anything else on the phone is never read.
    static final Set<String> BANK_PACKAGES = new HashSet<>(
        Arrays.asList(
            "com.popular.app.android",
            "com.banreservas.tubancoappmobile",
            "com.bhdleon.tdcdigital",
            "com.artech.infocorp_bhd.bhd"
        )
    );

    private static final String FILE = "xmoney_bank_notifications";
    private static final String KEY_ITEMS = "items";
    private static final String KEY_ENABLED = "enabled";
    private static final int MAX_ITEMS = 100; // a bounded inbox: the device storage is not a mailbox
    private static final int MAX_TITLE = 200;
    private static final int MAX_TEXT = 2000;

    private static Runnable onAdded;

    private BankNotificationStore() {}

    static synchronized void setOnAdded(Runnable callback) {
        onAdded = callback;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    static boolean isEnabled(Context context) {
        return prefs(context).getBoolean(KEY_ENABLED, false);
    }

    static void setEnabled(Context context, boolean enabled) {
        SharedPreferences.Editor editor = prefs(context).edit().putBoolean(KEY_ENABLED, enabled);
        // switching it off also forgets what was waiting: nothing is kept for a feature that is off
        if (!enabled) editor.remove(KEY_ITEMS);
        editor.apply();
    }

    private static JSONArray load(Context context) {
        try {
            return new JSONArray(prefs(context).getString(KEY_ITEMS, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static String clip(String value, int max) {
        if (value == null) return "";
        String v = value.trim();
        return v.length() > max ? v.substring(0, max) : v;
    }

    private static String idOf(String pkg, String title, String text, long postedAt) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest((pkg + "\n" + title + "\n" + text + "\n" + postedAt).getBytes("UTF-8"));
            StringBuilder out = new StringBuilder();
            for (int i = 0; i < 12; i++) out.append(String.format("%02x", hash[i]));
            return out.toString();
        } catch (Exception e) {
            return pkg + ":" + postedAt;
        }
    }

    /** Stores one notification; the same one twice (the app re-posting it) is stored once. */
    static void add(Context context, String pkg, String title, String text, long postedAt) {
        if (!BANK_PACKAGES.contains(pkg)) return;
        String t = clip(title, MAX_TITLE);
        String body = clip(text, MAX_TEXT);
        if (t.isEmpty() && body.isEmpty()) return;
        Runnable callback;
        synchronized (BankNotificationStore.class) {
            String id = idOf(pkg, t, body, postedAt);
            JSONArray items = load(context);
            for (int i = 0; i < items.length(); i++) {
                if (id.equals(items.optJSONObject(i) == null ? null : items.optJSONObject(i).optString("id"))) return;
            }
            try {
                JSONObject item = new JSONObject();
                item.put("id", id);
                item.put("pkg", pkg);
                item.put("title", t);
                item.put("text", body);
                item.put("postedAt", postedAt);
                items.put(item);
            } catch (JSONException e) {
                return;
            }
            JSONArray kept = new JSONArray();
            for (int i = Math.max(0, items.length() - MAX_ITEMS); i < items.length(); i++) kept.put(items.opt(i));
            prefs(context).edit().putString(KEY_ITEMS, kept.toString()).apply();
            callback = onAdded;
        }
        if (callback != null) callback.run();
    }

    static synchronized JSONArray pending(Context context) {
        return load(context);
    }

    static synchronized void ack(Context context, Set<String> ids) {
        JSONArray items = load(context);
        JSONArray kept = new JSONArray();
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item != null && !ids.contains(item.optString("id"))) kept.put(item);
        }
        prefs(context).edit().putString(KEY_ITEMS, kept.toString()).apply();
    }
}
