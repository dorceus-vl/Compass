package com.knocturnlabs.compass.widgets;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.widget.ArrayAdapter;
import android.widget.ListView;
import java.util.ArrayList;
import java.util.List;

/**
 * Project pulse's picker (A2): the launcher opens it when the widget is placed (before Android 12) or reconfigured (touch and hold).
 * It lists the snapshot's projects; an Offline-only one is listed without its name ("Offline-only project 2"). Only a Project pulse
 * widget of this app can be set from here.
 */
public final class ProjectPulseConfigActivity extends Activity {
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        setResult(RESULT_CANCELED);
        int id = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        AppWidgetProviderInfo info = id == AppWidgetManager.INVALID_APPWIDGET_ID ? null : AppWidgetManager.getInstance(this).getAppWidgetInfo(id);
        if (info == null || !new ComponentName(this, WidgetProviders.ProjectPulse.class).equals(info.provider)) { finish(); return; }
        Intent ok = new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        WidgetSnapshot s = WidgetStore.read(getFilesDir());
        if (s == null || s.projects.isEmpty()) { // nothing to pick yet: place it; it shows the placeholder or "No active projects"
            WidgetProviders.refreshAll(this);
            setResult(RESULT_OK, ok);
            finish();
            return;
        }
        List<String> names = new ArrayList<>();
        int offline = 0;
        for (WidgetSnapshot.Project p : s.projects) names.add(p.offline || p.name == null ? "Offline-only project " + (++offline) : p.name);
        setTitle(com.knocturnlabs.compass.R.string.widget_pick_project);
        ListView list = new ListView(this);
        list.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, names));
        list.setOnItemClickListener((parent, view, position, rowId) -> {
            WidgetProviders.pick(this, id, s.projects.get(position).id);
            WidgetProviders.refreshAll(this);
            setResult(RESULT_OK, ok);
            finish();
        });
        setContentView(list);
    }
}
