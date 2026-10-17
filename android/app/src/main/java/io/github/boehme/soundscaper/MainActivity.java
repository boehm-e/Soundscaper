package io.github.boehme.soundscaper;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SoundscaperFilesPlugin.class);
        super.onCreate(savedInstanceState);
        if (bridge == null) return;
        bridge.setWebViewClient(new SoundscaperWebViewClient(bridge));
        // The bridge starts navigation during super.onCreate. Restart it with
        // our response-header adapter installed before any editor code executes.
        bridge.getWebView().stopLoading();
        String route = BuildConfig.DEBUG && getIntent().getBooleanExtra("soundscaper.smoke", false)
                ? "/android-smoke.html" : "/embed/en/";
        bridge.getWebView().loadUrl("https://localhost" + route);
    }
}
