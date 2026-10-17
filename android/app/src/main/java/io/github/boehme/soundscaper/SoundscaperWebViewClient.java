/* SPDX-License-Identifier: AGPL-3.0-only */
package io.github.boehme.soundscaper;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import org.json.JSONObject;

/** Preserve the web application's CSP and isolation headers on bundled assets. */
final class SoundscaperWebViewClient extends BridgeWebViewClient {
    private final Map<String, String> headers = new HashMap<>();

    SoundscaperWebViewClient(Bridge bridge) {
        super(bridge);
        try (InputStream input = bridge.getContext().getAssets().open("public/soundscaper-headers.json")) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
            JSONObject values = new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
            Iterator<String> names = values.keys();
            while (names.hasNext()) {
                String name = names.next();
                headers.put(name, values.getString(name));
            }
        } catch (Exception error) {
            throw new IllegalStateException("Bundled response headers are missing", error);
        }
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        WebResourceResponse response = super.shouldInterceptRequest(view, request);
        if (response != null && "https".equals(request.getUrl().getScheme())
                && "localhost".equals(request.getUrl().getHost())) {
            Map<String, String> combined = new HashMap<>();
            if (response.getResponseHeaders() != null) combined.putAll(response.getResponseHeaders());
            combined.putAll(headers);
            response.setResponseHeaders(combined);
        }
        return response;
    }
}
