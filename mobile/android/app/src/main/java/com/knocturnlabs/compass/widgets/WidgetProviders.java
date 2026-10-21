package com.knocturnlabs.compass.widgets;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Bundle;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.StyleSpan;
import android.view.View;
import android.widget.RemoteViews;
import com.knocturnlabs.compass.MainActivity;
import com.knocturnlabs.compass.R;
import java.util.ArrayList;
import java.util.List;

/**
 * The Compass widgets on Android (v2.3 Task 2b, A1/A2): classic AppWidgetProviders drawing RemoteViews from the snapshot the page writes
 * (WidgetStore). One provider per widget, so each has its own size in the picker: Today small, medium and large, Quick add, Ask Athena,
 * Project pulse and This week. Same content rules as iOS: an Offline-only task or project is never named (the snapshot has no title);
 * there is no Lock Screen widget on Android, so work titles show as on the iOS Home Screen. Taps open MainActivity with an https Compass
 * link (A6), which CompassNativePlugin routes through CompassLink.open (Compass only); ticks go to TickReceiver. Every PendingIntent is
 * explicit and immutable, and rows are added views, not a collection, so no fill-in intent is needed.
 */
public final class WidgetProviders {
    private WidgetProviders() {}

    public abstract static class Base extends AppWidgetProvider {
        abstract RemoteViews view(Context c, WidgetSnapshot s, int id, int heightDp);

        @Override
        public void onUpdate(Context c, AppWidgetManager m, int[] ids) { draw(c, m, ids, this); }

        @Override
        public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, Bundle options) { draw(c, m, new int[] { id }, this); }
    }

    public static final class TodaySmall extends Base {
        RemoteViews view(Context c, WidgetSnapshot s, int id, int h) { return todaySmall(c, s); }
    }

    public static final class TodayMedium extends Base {
        RemoteViews view(Context c, WidgetSnapshot s, int id, int h) { return todayMedium(c, s, h); }
    }

    public static final class TodayLarge extends Base {
        RemoteViews view(Context c, WidgetSnapshot s, int id, int h) { return todayLarge(c, s, h); }
    }

    public static final class QuickAdd extends Base {
        RemoteViews view(Context c, WidgetSnapshot s, int id, int h) { return tap(c, new RemoteViews(c.getPackageName(), R.layout.widget_quick_add), WidgetUrls.QUICK_ADD); }
    }

    public static final class AskAthena extends Base {
        RemoteViews view(Context c, WidgetSnapshot s, int id, int h) { return tap(c, new RemoteViews(c.getPackageName(), R.layout.widget_ask_athena), WidgetUrls.ATHENA); }
    }

    public static final class ProjectPulse extends Base {
        RemoteViews view(Context c, WidgetSnapshot s, int id, int h) { return pulse(c, s, picked(c, id, s)); }

        @Override
        public void onDeleted(Context c, int[] ids) {
            SharedPreferences.Editor e = pulsePrefs(c).edit();
            for (int id : ids) e.remove(String.valueOf(id));
            e.apply();
        }
    }

    public static final class Week extends Base {
        RemoteViews view(Context c, WidgetSnapshot s, int id, int h) { return week(c, s, h); }
    }

    /** Local midnight: every Compass widget redraws, so "Today" rolls over (or says to open Compass), then the next midnight is armed. */
    public static final class Midnight extends BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent intent) { refreshAll(c); }
    }

    /** One inexact alarm in a 15-minute window after midnight (setWindow needs no exact-alarm permission; never early, no wake-up), replaced each time a widget draws. */
    static void armMidnight(Context c, WidgetSnapshot s) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        if (am == null) return;
        PendingIntent pi = PendingIntent.getBroadcast(c, 0, new Intent(c, Midnight.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        am.setWindow(AlarmManager.RTC, WidgetSnapshot.nextMidnight(System.currentTimeMillis(), s == null ? null : s.tz) + 60_000, 15 * 60_000, pi);
    }

    private static Base[] all() { return new Base[] { new TodaySmall(), new TodayMedium(), new TodayLarge(), new QuickAdd(), new AskAthena(), new ProjectPulse(), new Week() }; }

    /** Redraws every Compass widget on the screen (after the page writes a snapshot, after a tick, after a project is picked). */
    public static void refreshAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        if (m == null) return;
        for (Base kind : all()) {
            int[] ids = m.getAppWidgetIds(new ComponentName(c, kind.getClass()));
            if (ids != null && ids.length > 0) draw(c, m, ids, kind);
        }
    }

    static void draw(Context c, AppWidgetManager m, int[] ids, Base kind) {
        WidgetSnapshot s = WidgetStore.read(c.getFilesDir());
        boolean landscape = c.getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
        for (int id : ids) {
            Bundle o = m.getAppWidgetOptions(id);
            int h = o == null ? 0 : o.getInt(landscape ? AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT : AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT);
            m.updateAppWidget(id, kind.view(c, s, id, h));
        }
        armMidnight(c, s);
    }

    // ---- Project pulse: which project each widget shows (picked in ProjectPulseConfigActivity; the first one until then) ----

    static SharedPreferences pulsePrefs(Context c) { return c.getSharedPreferences("compass_widget_pulse", Context.MODE_PRIVATE); }

    static void pick(Context c, int widgetId, String projectId) { pulsePrefs(c).edit().putString(String.valueOf(widgetId), projectId).apply(); }

    static WidgetSnapshot.Project picked(Context c, int widgetId, WidgetSnapshot s) {
        if (s == null || s.projects.isEmpty()) return null;
        String want = pulsePrefs(c).getString(String.valueOf(widgetId), null);
        if (want == null) return s.projects.get(0);
        for (WidgetSnapshot.Project p : s.projects) if (want.equals(p.id)) return p;
        return null; // its project left the snapshot: ask for another
    }

    // ---- drawing ----

    private static int col(Context c, int res) { return c.getColor(res); }

    static PendingIntent open(Context c, String url) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url), c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static RemoteViews tap(Context c, RemoteViews v, String url) {
        v.setOnClickPendingIntent(R.id.root, open(c, url));
        return v;
    }

    private static RemoteViews placeholder(Context c) { return tap(c, new RemoteViews(c.getPackageName(), R.layout.widget_placeholder), WidgetUrls.TODAY); }

    private static int horizon(Context c, String h) { return col(c, "short".equals(h) ? R.color.w_short : "medium".equals(h) ? R.color.w_medium : R.color.w_long); }

    private static int rag(Context c, String r) {
        return col(c, "green".equals(r) ? R.color.w_ok : "amber".equals(r) ? R.color.w_warn : "red".equals(r) ? R.color.w_danger : R.color.w_faint);
    }

    /** "Today · Wed Oct 21", or a nudge when the snapshot is from another day (before the app writes again). */
    private static String todayHead(WidgetSnapshot s, String rest) {
        long now = System.currentTimeMillis();
        return s.isStale(now) ? "Today · open Compass to update" : "Today · " + (rest != null ? rest : WidgetSnapshot.header(now, s.tz));
    }

    private static RemoteViews row(Context c, WidgetSnapshot.Item it) {
        RemoteViews r = new RemoteViews(c.getPackageName(), R.layout.widget_row);
        String name = it.shown();
        r.setInt(R.id.bar, "setColorFilter", horizon(c, it.horizon));
        r.setTextViewText(R.id.title, name);
        r.setTextColor(R.id.title, col(c, it.named() ? R.color.w_text : R.color.w_dim));
        r.setTextViewText(R.id.due, it.dueLabel);
        r.setTextColor(R.id.due, col(c, it.late ? R.color.w_danger : R.color.w_faint));
        r.setOnClickPendingIntent(R.id.tick, TickReceiver.intent(c, it.id));
        r.setContentDescription(R.id.tick, "Mark done: " + name);
        r.setOnClickPendingIntent(R.id.open, open(c, WidgetUrls.task(it.id)));
        r.setContentDescription(R.id.open, name + ", " + (it.late ? "late, " : "") + it.dueLabel);
        return r;
    }

    private static RemoteViews label(Context c, String text) {
        RemoteViews r = new RemoteViews(c.getPackageName(), R.layout.widget_label);
        r.setTextViewText(R.id.label, text);
        return r;
    }

    private static RemoteViews line(Context c, String text, Integer barColor) {
        RemoteViews r = new RemoteViews(c.getPackageName(), R.layout.widget_line);
        r.setTextViewText(R.id.text, text);
        if (barColor != null) {
            r.setViewVisibility(R.id.bar, View.VISIBLE);
            r.setInt(R.id.bar, "setColorFilter", barColor);
        }
        return r;
    }

    private static void ring(RemoteViews v, int done, int total, String text, String spoken) {
        v.setProgressBar(R.id.ring, 100, total > 0 ? Math.round(100f * Math.min(done, total) / total) : 0, false);
        v.setTextViewText(R.id.ring_text, text);
        v.setContentDescription(R.id.ring_box, spoken);
    }

    /** Rows of 30 dp that fit `heightDp` after `fixedDp` (head, padding, footer); `fallback` when the launcher gave no size. */
    private static int fits(int heightDp, int fixedDp, int fallback) { return heightDp <= 0 ? fallback : Math.max(1, (heightDp - fixedDp) / 30); }

    static RemoteViews todaySmall(Context c, WidgetSnapshot s) {
        if (s == null) return placeholder(c);
        RemoteViews v = tap(c, new RemoteViews(c.getPackageName(), R.layout.widget_today_small), WidgetUrls.TODAY);
        v.setTextViewText(R.id.head, "Today");
        if (s.isStale(System.currentTimeMillis())) {
            v.setViewVisibility(R.id.count, View.GONE);
            v.setViewVisibility(R.id.next_label, View.GONE);
            v.setViewVisibility(R.id.next, View.GONE);
            v.setTextViewText(R.id.sub, "Open Compass to update");
            v.setContentDescription(R.id.root, "Today: open Compass to update");
            return v;
        }
        v.setTextViewText(R.id.count, String.valueOf(s.due));
        SpannableStringBuilder sub = new SpannableStringBuilder("due");
        if (s.late > 0) {
            sub.append(" · ");
            int from = sub.length();
            sub.append(s.late + " late");
            sub.setSpan(new ForegroundColorSpan(col(c, R.color.w_danger)), from, sub.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        v.setTextViewText(R.id.sub, sub);
        String next = s.next == null ? "Nothing else due" : s.next.shown();
        v.setTextViewText(R.id.next, next);
        v.setTextColor(R.id.next, col(c, s.next != null && !s.next.named() ? R.color.w_dim : R.color.w_text));
        v.setContentDescription(R.id.root, "Today: " + s.due + " due, " + s.late + " late. Next: " + (s.next == null ? "nothing" : next));
        return v;
    }

    static RemoteViews todayMedium(Context c, WidgetSnapshot s, int h) {
        if (s == null) return placeholder(c);
        RemoteViews v = tap(c, new RemoteViews(c.getPackageName(), R.layout.widget_today_medium), WidgetUrls.TODAY);
        v.setTextViewText(R.id.head, todayHead(s, null));
        v.removeAllViews(R.id.rows);
        if (s.items.isEmpty()) v.addView(R.id.rows, line(c, "Nothing due. The day is yours.", null));
        int n = Math.min(5, fits(h, 50, 3)); // three at the compact size, up to five when the widget is taller
        for (int i = 0; i < Math.min(n, s.items.size()); i++) v.addView(R.id.rows, row(c, s.items.get(i)));
        ring(v, s.done, s.total, s.done + "/" + s.total, s.done + " of " + s.total + " done today");
        return v;
    }

    static RemoteViews todayLarge(Context c, WidgetSnapshot s, int h) {
        if (s == null) return placeholder(c);
        RemoteViews v = tap(c, new RemoteViews(c.getPackageName(), R.layout.widget_today_large), WidgetUrls.TODAY);
        v.setTextViewText(R.id.head, todayHead(s, s.due + " due"));
        v.removeAllViews(R.id.rows);
        WidgetSnapshot.Project f = s.footerMilestone();
        // Rows by horizon, short first, within what the widget holds: 7 (one fewer with the Blocked line), fewer on a short launcher cell.
        int left = Math.min(s.blocked > 0 ? 6 : 7, fits(h, (f != null ? 96 : 50) + (s.blocked > 0 ? 40 : 0), 7));
        String[] names = { "Short", "Medium", "Long" };
        List<List<WidgetSnapshot.Item>> groups = new ArrayList<>();
        groups.add(s.shortItems); groups.add(s.mediumItems); groups.add(s.longItems);
        boolean any = false;
        for (int g = 0; g < 3 && left > 0; g++) {
            List<WidgetSnapshot.Item> list = groups.get(g);
            if (list.isEmpty()) continue;
            v.addView(R.id.rows, label(c, names[g]));
            for (int i = 0; i < list.size() && left > 0; i++, left--) v.addView(R.id.rows, row(c, list.get(i)));
            any = true;
        }
        if (!any && s.blocked == 0) v.addView(R.id.rows, line(c, "Nothing due. The day is yours.", null));
        if (s.blocked > 0) {
            v.addView(R.id.rows, label(c, "Blocked (" + s.blocked + ")"));
            v.addView(R.id.rows, line(c, s.blocked == 1 ? "1 task waits on another task" : s.blocked + " tasks wait on other tasks", col(c, R.color.w_long)));
        }
        if (f == null) {
            v.setViewVisibility(R.id.footer, View.GONE);
        } else {
            SpannableStringBuilder m = new SpannableStringBuilder(f.milestoneName);
            if (f.milestoneLateDays > 0) {
                m.append(" · ");
                int from = m.length();
                m.append(f.milestoneLateDays + " day" + (f.milestoneLateDays == 1 ? "" : "s") + " late");
                m.setSpan(new ForegroundColorSpan(col(c, R.color.w_warn)), from, m.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
            v.setTextViewText(R.id.milestone, m);
        }
        return v;
    }

    static RemoteViews pulse(Context c, WidgetSnapshot s, WidgetSnapshot.Project p) {
        if (s == null) return placeholder(c);
        if (p == null) {
            RemoteViews v = tap(c, new RemoteViews(c.getPackageName(), R.layout.widget_pulse), WidgetUrls.TODAY);
            v.setViewVisibility(R.id.body, View.GONE);
            v.setViewVisibility(R.id.rag, View.GONE);
            v.setViewVisibility(R.id.message, View.VISIBLE);
            v.setTextViewText(R.id.name, "Project pulse");
            v.setTextViewText(R.id.message, s.projects.isEmpty() ? "No active projects" : "Touch and hold the widget to pick a project");
            return v;
        }
        RemoteViews v = tap(c, new RemoteViews(c.getPackageName(), R.layout.widget_pulse), WidgetUrls.dashboard(p.id));
        v.setTextViewText(R.id.name, p.shownName());
        if ("none".equals(p.rag)) {
            v.setViewVisibility(R.id.rag, View.GONE);
        } else {
            v.setTextViewText(R.id.rag, p.rag);
            v.setTextColor(R.id.rag, rag(c, p.rag));
            v.setInt(R.id.rag, "setBackgroundResource", "green".equals(p.rag) ? R.drawable.widget_pill_ok : "amber".equals(p.rag) ? R.drawable.widget_pill_warn : R.drawable.widget_pill_danger);
        }
        SpannableStringBuilder m = new SpannableStringBuilder();
        if (!p.hasMilestone) m.append("No open milestone");
        else if (p.milestoneName == null || p.offline) m.append("Next milestone");
        else {
            m.append("Next: ");
            int from = m.length();
            m.append(p.milestoneName);
            m.setSpan(new StyleSpan(android.graphics.Typeface.BOLD), from, m.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            m.setSpan(new ForegroundColorSpan(col(c, R.color.w_text)), from, m.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        if (p.hasMilestone && p.milestoneLateDays > 0) {
            int from = m.length();
            m.append(" · " + p.milestoneLateDays + "d late");
            m.setSpan(new ForegroundColorSpan(col(c, R.color.w_warn)), from, m.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        v.setTextViewText(R.id.milestone, m);
        v.setTextViewText(R.id.slip, slip(p.slipDays));

        if (s.isStale(System.currentTimeMillis())) v.setTextViewText(R.id.risks, "Open Compass to update"); // yesterday's overdue count would mislead
        else v.setTextViewText(R.id.risks, (p.highRisks == null ? "" : p.highRisks + " high risk" + (p.highRisks == 1 ? "" : "s") + " · ") + p.overdue + " overdue");
        ring(v, p.pct, 100, p.pct + "%", p.pct + "% done");
        v.setContentDescription(R.id.root, p.shownName() + ", " + ("none".equals(p.rag) ? "no RAG" : p.rag) + ", " + p.pct + "% done");
        return v;
    }

    static String slip(Integer d) {
        if (d == null) return "No baseline yet";
        if (d == 0) return "On the baseline";
        return d > 0 ? d + " day" + (d == 1 ? "" : "s") + " later than the baseline" : -d + " day" + (d == -1 ? "" : "s") + " ahead of the baseline";
    }

    static RemoteViews week(Context c, WidgetSnapshot s, int h) {
        if (s == null) return placeholder(c);
        RemoteViews v = tap(c, new RemoteViews(c.getPackageName(), R.layout.widget_week), WidgetUrls.TODAY);
        v.setTextViewText(R.id.head, s.isStale(System.currentTimeMillis()) ? "This week · open Compass to update" : "This week · " + s.weekOpen() + " open");
        String today = WidgetSnapshot.ymd(System.currentTimeMillis(), s.tz);
        v.removeAllViews(R.id.days);
        for (WidgetSnapshot.Day d : s.week) {
            RemoteViews cell = new RemoteViews(c.getPackageName(), R.layout.widget_day);
            boolean isToday = d.day.equals(today);
            cell.setTextViewText(R.id.day_name, WidgetSnapshot.weekday(d.day));
            cell.setTextColor(R.id.day_name, col(c, isToday ? R.color.w_accent : R.color.w_faint));
            if (isToday) cell.setInt(R.id.cell, "setBackgroundResource", R.drawable.widget_cell_today);
            cell.removeAllViews(R.id.bars);
            int shown = 0;
            int[][] bars = { { d.shortCount, R.color.w_short }, { d.mediumCount, R.color.w_medium }, { d.longCount, R.color.w_long } };
            for (int[] b : bars) for (int i = 0; i < b[0] && shown < 6; i++, shown++) {
                RemoteViews bar = new RemoteViews(c.getPackageName(), R.layout.widget_day_bar);
                bar.setInt(R.id.day_bar, "setColorFilter", col(c, b[1]));
                cell.addView(R.id.bars, bar);
            }
            if (d.total() > shown) {
                cell.setViewVisibility(R.id.more, View.VISIBLE);
                cell.setTextViewText(R.id.more, "+" + (d.total() - shown));
            }
            cell.setContentDescription(R.id.cell, WidgetSnapshot.weekday(d.day) + (isToday ? ", today" : "") + ": " + d.total() + " task" + (d.total() == 1 ? "" : "s"));
            v.addView(R.id.days, cell);
        }
        v.removeAllViews(R.id.rows);
        // What fits under the strip: tasks first, then up to 4 projects with their label.
        int slots = fits(h, 120, 4);
        int projects = s.projects.isEmpty() ? 0 : Math.min(Math.min(4, s.projects.size()), slots / 3);
        int tasks = Math.max(1, slots - (projects > 0 ? projects + 1 : 0));
        if (s.items.isEmpty()) v.addView(R.id.rows, line(c, "Nothing open. The week is yours.", null));
        for (int i = 0; i < Math.min(tasks, s.items.size()); i++) v.addView(R.id.rows, row(c, s.items.get(i)));
        if (projects > 0) v.addView(R.id.rows, label(c, "Projects"));
        for (int i = 0; i < projects; i++) {
            WidgetSnapshot.Project p = s.projects.get(i);
            RemoteViews r = new RemoteViews(c.getPackageName(), R.layout.widget_project_row);
            r.setInt(R.id.dot, "setColorFilter", rag(c, p.rag));
            r.setTextViewText(R.id.name, p.shownName());
            r.setTextColor(R.id.name, col(c, p.offline ? R.color.w_dim : R.color.w_text));
            r.setTextViewText(R.id.pct, p.pct + "%");
            r.setOnClickPendingIntent(R.id.project, open(c, WidgetUrls.dashboard(p.id)));
            r.setContentDescription(R.id.project, p.shownName() + ", " + ("none".equals(p.rag) ? "no RAG" : p.rag) + ", " + p.pct + "% done");
            v.addView(R.id.rows, r);
        }
        return v;
    }
}
