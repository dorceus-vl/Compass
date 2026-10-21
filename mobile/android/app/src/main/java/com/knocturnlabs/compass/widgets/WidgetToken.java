package com.knocturnlabs.compass.widgets;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.io.IOException;
import java.security.Key;
import java.security.KeyStore;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

/**
 * The widget's tick token on Android (A5, the twin of the iOS Keychain item): sealed with AES-GCM under a key held in the Android
 * Keystore (alias compass_widget_token: no user authentication, never exportable), the sealed bytes kept in app-private SharedPreferences
 * (the app has allowBackup=false). Set only by CompassNativePlugin.setWidgetToken; read only by TickReceiver. The page never gets it back.
 */
public final class WidgetToken {
    static final String ALIAS = "compass_widget_token";
    private static final String PREFS = "compass_widget_token", KEY = "sealed";

    private WidgetToken() {}

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    private static KeyStore keystore() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        return ks;
    }

    /** Stores the token under a fresh key, or with null deletes both. A token that isn't the server's shape is refused before anything is deleted. */
    public static synchronized void set(Context c, String token) throws Exception {
        if (token != null && !WidgetStore.validToken(token)) throw new IllegalArgumentException("invalid token");
        // The sealed token goes first, before the Keystore is touched: if the Keystore fails, nothing readable is left behind.
        if (!prefs(c).edit().remove(KEY).commit()) throw new IOException("not removed");
        KeyStore ks = keystore();
        if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS);
        if (token == null) return;
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        String sealed = Base64.encodeToString(WidgetStore.seal(g.generateKey(), token), Base64.NO_WRAP); // written only once sealing worked
        if (!prefs(c).edit().putString(KEY, sealed).commit()) throw new IOException("not saved");
    }

    /** The stored token, or null when there is none or it can't be opened (the key is gone, the bytes changed). */
    public static synchronized String read(Context c) {
        String sealed = prefs(c).getString(KEY, null);
        if (sealed == null) return null;
        try {
            Key k = keystore().getKey(ALIAS, null);
            return k instanceof SecretKey ? WidgetStore.open((SecretKey) k, Base64.decode(sealed, Base64.NO_WRAP)) : null;
        } catch (Exception e) {
            return null;
        }
    }
}
