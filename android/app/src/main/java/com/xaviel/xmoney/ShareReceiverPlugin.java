package com.xaviel.xmoney;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Receives images, PDFs and text shared from other apps (ACTION_SEND / ACTION_SEND_MULTIPLE).
 * Streams are copied into the app cache (at most 10 files, 8 MB each; anything else is ignored)
 * and handed to the web layer once; the web layer deletes each file after reading it.
 */
@CapacitorPlugin(name = "ShareReceiver")
public class ShareReceiverPlugin extends Plugin {

    private static final int MAX_ITEMS = 10;
    private static final long MAX_BYTES = 8L * 1024 * 1024;
    private static final int MAX_TEXT_CHARS = 20000;

    private final List<JSObject> pending = new ArrayList<>();

    @Override
    public void load() {
        collect(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (collect(intent)) notifyListeners("shared", new JSObject());
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        JSArray items = new JSArray();
        synchronized (pending) {
            for (JSObject item : pending) items.put(item);
            pending.clear();
        }
        JSObject result = new JSObject();
        result.put("items", items);
        call.resolve(result);
    }

    private boolean collect(Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return false;

        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri one = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (one != null) uris.add(one);
        } else {
            ArrayList<Uri> many = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null) uris.addAll(many);
        }

        boolean added = false;
        String type = intent.getType();
        for (Uri uri : uris) {
            if (count() >= MAX_ITEMS) break;
            JSObject item = copy(uri, type);
            if (item != null) {
                add(item);
                added = true;
            }
        }
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (uris.isEmpty() && text != null && text.length() > 0 && count() < MAX_ITEMS) {
            String value = text.toString();
            JSObject item = new JSObject();
            item.put("kind", "text");
            item.put("mimeType", "text/plain");
            item.put("text", value.length() > MAX_TEXT_CHARS ? value.substring(0, MAX_TEXT_CHARS) : value);
            add(item);
            added = true;
        }
        // consumed: a later recreation of the activity must not deliver it again
        intent.setAction(Intent.ACTION_MAIN);
        intent.removeExtra(Intent.EXTRA_STREAM);
        intent.removeExtra(Intent.EXTRA_TEXT);
        return added;
    }

    private int count() {
        synchronized (pending) {
            return pending.size();
        }
    }

    private void add(JSObject item) {
        synchronized (pending) {
            pending.add(item);
        }
    }

    private JSObject copy(Uri uri, String intentType) {
        ContentResolver resolver = getContext().getContentResolver();
        String mime = resolver.getType(uri);
        if (mime == null) mime = intentType;
        if (mime == null) return null;
        String kind;
        String extension;
        if (mime.startsWith("image/")) {
            kind = "image";
            extension = ".img";
        } else if ("application/pdf".equals(mime)) {
            kind = "pdf";
            extension = ".pdf";
        } else {
            return null;
        }
        File dir = new File(getContext().getCacheDir(), "shared");
        if (!dir.exists() && !dir.mkdirs()) return null;
        File target = new File(dir, UUID.randomUUID().toString() + extension);
        long total = 0;
        try (InputStream in = resolver.openInputStream(uri); FileOutputStream out = new FileOutputStream(target)) {
            if (in == null) return null;
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                total += read;
                if (total > MAX_BYTES) {
                    out.close();
                    target.delete();
                    return null;
                }
                out.write(buffer, 0, read);
            }
        } catch (IOException | SecurityException e) {
            target.delete();
            return null;
        }
        if (total == 0) {
            target.delete();
            return null;
        }
        JSObject item = new JSObject();
        item.put("kind", kind);
        item.put("mimeType", mime);
        String name = displayName(resolver, uri);
        if (name != null) item.put("name", name);
        item.put("path", Uri.fromFile(target).toString());
        return item;
    }

    private String displayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                return name != null && name.length() > 120 ? name.substring(0, 120) : name;
            }
        } catch (RuntimeException ignored) {
            // the name is only a label
        }
        return null;
    }
}
