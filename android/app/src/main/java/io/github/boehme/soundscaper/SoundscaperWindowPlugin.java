/* SPDX-License-Identifier: AGPL-3.0-only */
package io.github.boehme.soundscaper;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Keep the editor's fullscreen control in sync with Android's system bars. */
@CapacitorPlugin(name = "SoundscaperWindow")
public final class SoundscaperWindowPlugin extends Plugin {
    @PluginMethod
    public void setFullscreen(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("A fullscreen state is required.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            ((MainActivity) getActivity()).setFullscreen(enabled);
            call.resolve();
        });
    }
}
