package io.github.boehme.soundscaper;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean fullscreen = true;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SoundscaperFilesPlugin.class);
        registerPlugin(SoundscaperWindowPlugin.class);
        super.onCreate(savedInstanceState);
        applyFullscreen();
        if (bridge == null) return;
        bridge.setWebViewClient(new SoundscaperWebViewClient(bridge));
        // The bridge starts navigation during super.onCreate. Restart it with
        // our response-header adapter installed before any editor code executes.
        bridge.getWebView().stopLoading();
        String route = BuildConfig.DEBUG && getIntent().getBooleanExtra("soundscaper.smoke", false)
                ? "/android-smoke.html" : "/embed/en/";
        bridge.getWebView().loadUrl("https://localhost" + route);
    }

    public void setFullscreen(boolean enabled) {
        fullscreen = enabled;
        applyFullscreen();
    }

    private void applyFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), !fullscreen);
        WindowInsetsControllerCompat insets = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        insets.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        if (fullscreen) insets.hide(WindowInsetsCompat.Type.systemBars());
        else insets.show(WindowInsetsCompat.Type.systemBars());
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyFullscreen();
    }
}
