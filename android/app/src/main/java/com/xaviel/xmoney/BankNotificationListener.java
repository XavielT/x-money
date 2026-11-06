package com.xaviel.xmoney;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/**
 * Hears notifications posted by the bank apps listed in BankNotificationStore and keeps their text on the
 * device. It never reads other apps, never sends anything anywhere and never writes a movement: the web
 * layer turns each item into a draft that the user approves. Does nothing while the switch in Settings is off.
 */
public class BankNotificationListener extends NotificationListenerService {

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;
        String pkg = sbn.getPackageName();
        if (!BankNotificationStore.BANK_PACKAGES.contains(pkg)) return; // before anything else: other apps are never looked at
        if (!BankNotificationStore.isEnabled(this)) return;
        Notification notification = sbn.getNotification();
        if (notification == null) return;
        if ((notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return; // the "3 new messages" header
        Bundle extras = notification.extras;
        if (extras == null) return;
        String title = text(extras.getCharSequence(Notification.EXTRA_TITLE));
        String body = text(extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
        if (body.isEmpty()) body = text(extras.getCharSequence(Notification.EXTRA_TEXT));
        BankNotificationStore.add(this, pkg, title, body, sbn.getPostTime());
    }

    private static String text(CharSequence value) {
        return value == null ? "" : value.toString();
    }
}
