/* SPDX-License-Identifier: AGPL-3.0-only */
package io.github.boehme.soundscaper;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** User-selected exports, staged privately with bounded bridge messages. */
@CapacitorPlugin(name = "SoundscaperFiles")
public final class SoundscaperFilesPlugin extends Plugin {
    private static final int MAX_CHUNK_BYTES = 192 * 1024;
    private final Map<String, Target> targets = new HashMap<>();
    private boolean pickerActive;

    private static final class Target {
        final Uri uri;
        File file;
        RandomAccessFile writer;
        Target(Uri uri) { this.uri = uri; }
        void dispose() {
            try { if (writer != null) writer.close(); } catch (Exception ignored) { }
            if (file != null) file.delete();
        }
    }

    @PluginMethod
    public void chooseSaveTarget(PluginCall call) {
        if (pickerActive || targets.size() >= 8) {
            call.reject("Another Android save is already pending.");
            return;
        }
        pickerActive = true;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mimeType", "application/octet-stream"));
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", "export.wav"));
        startActivityForResult(call, intent, "documentChosen");
    }

    @ActivityCallback
    private void documentChosen(PluginCall call, ActivityResult result) {
        pickerActive = false;
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }
        String id = UUID.randomUUID().toString();
        targets.put(id, new Target(data.getData()));
        call.resolve(new JSObject().put("targetId", id).put("name", call.getString("name", "export.wav")));
    }

    @PluginMethod
    public void beginWrite(PluginCall call) {
        try {
            Target target = target(call);
            if (target.writer != null) throw new IllegalStateException("Save stream already opened.");
            target.file = File.createTempFile("scape-export-", ".part", getContext().getCacheDir());
            target.writer = new RandomAccessFile(target.file, "rw");
            call.resolve();
        } catch (Exception error) { fail(call, error); }
    }

    @PluginMethod
    public void writeChunk(PluginCall call) {
        try {
            Target target = target(call);
            String data = call.getString("data", "");
            if (target.writer == null || data.length() > ((MAX_CHUNK_BYTES + 2) / 3) * 4) {
                throw new IllegalArgumentException("Invalid Android save chunk.");
            }
            double positionValue = call.getData().getDouble("position");
            if (!Double.isFinite(positionValue) || positionValue != Math.rint(positionValue)
                    || positionValue < 0 || positionValue > target.writer.length()) {
                throw new IllegalArgumentException("Invalid Android save position.");
            }
            long position = (long) positionValue;
            byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
            if (bytes.length > MAX_CHUNK_BYTES) throw new IllegalArgumentException("Save chunk is too large.");
            target.writer.seek(position);
            target.writer.write(bytes);
            call.resolve(new JSObject().put("position", position + bytes.length));
        } catch (Exception error) { fail(call, error); }
    }

    @PluginMethod
    public void finishWrite(PluginCall call) {
        Target target = null;
        try {
            target = target(call);
            if (target.writer == null) throw new IllegalStateException("Save stream is not open.");
            target.writer.getFD().sync();
            target.writer.close();
            target.writer = null;
            try (FileInputStream input = new FileInputStream(target.file);
                    OutputStream output = getContext().getContentResolver().openOutputStream(target.uri, "wt")) {
                if (output == null) throw new IllegalStateException("Android could not open the destination.");
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                output.flush();
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("Android could not finish the export: " + error.getMessage(), error);
        } finally {
            targets.remove(call.getString("targetId"));
            if (target != null) target.dispose();
        }
    }

    @PluginMethod
    public void abortWrite(PluginCall call) {
        Target target = targets.remove(call.getString("targetId"));
        if (target != null) target.dispose();
        call.resolve();
    }

    private Target target(PluginCall call) {
        Target target = targets.get(call.getString("targetId"));
        if (target == null) throw new IllegalArgumentException("Unknown Android save target.");
        return target;
    }

    private void fail(PluginCall call, Exception error) {
        Target target = targets.remove(call.getString("targetId"));
        if (target != null) target.dispose();
        call.reject("Android save failed: " + error.getMessage(), error);
    }

    @Override
    protected void handleOnDestroy() {
        for (Target target : targets.values()) target.dispose();
        targets.clear();
    }
}
