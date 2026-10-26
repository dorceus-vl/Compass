package com.knocturnlabs.compass.widgets;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The widget snapshot (v2.3, W1) as shared/widget-snapshot.ts writes it, read on Android (A3). org.json and java.util only, so
 * mobile/test-java.sh checks it with javac and the SDK's org.json sources. Every field is read leniently (a missing one is empty or 0);
 * a file that isn't JSON or isn't version 1 is null, and the widgets show "Open Compass once to fill this widget". The twin of
 * ios/App/CompassWidgets/Snapshot.swift: same tick arithmetic, same title rules.
 */
public final class WidgetSnapshot {
    public static final class Item {
        public final String id, title, dueLabel, horizon, project;
        public final boolean late, work, offline, timerRunning;

        Item(JSONObject o) {
            id = str(o, "id"); title = str(o, "title"); dueLabel = nz(str(o, "due_label")); horizon = nz(str(o, "horizon")); project = str(o, "project");
            late = o.optBoolean("late"); work = o.optBoolean("work"); offline = o.optBoolean("offline"); timerRunning = o.optBoolean("timer_running");
        }

        /** An Offline-only task is never named (W1 gives it no title). No Lock Screen on Android (A2), so a work title shows as it is. */
        public String shown() { return title == null || offline ? "Offline-only task" : title; }
        public boolean named() { return title != null && !offline; }
    }

    /** A running timer (v2.5): a task's (taskId) or a project's (null). title is null where the builder wouldn't name it; never a note. */
    public static final class Timer {
        public final String id, taskId, title, startedAt;
        public final boolean work;

        Timer(JSONObject o) { id = str(o, "id"); taskId = str(o, "task_id"); title = str(o, "title"); startedAt = nz(str(o, "started_at")); work = o.optBoolean("work"); }

        /** No Lock Screen on Android (A2), so a work title shows as it is; an unnamed timer is "Running timer". */
        public String shown() { return title == null ? "Running timer" : title; }

        /** When it started (epoch ms), or `fallback` when started_at can't be read. */
        public long startedMillis(long fallback) { Long t = millis(startedAt); return t == null ? fallback : t; }
    }

    public static final class Project {
        public final String id, name, rag, milestoneName;
        public final int pct, overdue, milestoneLateDays;
        public final boolean work, offline, hasMilestone;
        public final Integer slipDays, highRisks;

        Project(JSONObject o) {
            id = str(o, "id"); name = str(o, "name"); rag = o.isNull("rag") ? "none" : o.optString("rag", "none");
            pct = o.optInt("pct"); overdue = o.optInt("overdue"); work = o.optBoolean("work"); offline = o.optBoolean("offline");
            JSONObject m = o.optJSONObject("next_milestone");
            hasMilestone = m != null; milestoneName = m == null ? null : str(m, "name"); milestoneLateDays = m == null ? 0 : m.optInt("late_days");
            slipDays = o.isNull("slip_days") ? null : o.optInt("slip_days"); highRisks = o.isNull("high_risks") ? null : o.optInt("high_risks");
        }

        public String shownName() { return offline || name == null ? "Offline-only project" : name; }
    }

    public static final class Day {
        public final String day;
        public final int shortCount, mediumCount, longCount;

        Day(JSONObject o) { day = nz(str(o, "day")); shortCount = o.optInt("short"); mediumCount = o.optInt("medium"); longCount = o.optInt("long"); }

        public int total() { return shortCount + mediumCount + longCount; }
    }

    private final JSONObject json; // the whole file: a tick rewrites it, keeping every field
    public final String at, tz;
    public final int due, late, done, total, blocked;
    public final Item next;
    public final List<Item> items, shortItems, mediumItems, longItems;
    public final List<Timer> timers;
    public final List<Project> projects;
    public final List<Day> week;

    private WidgetSnapshot(JSONObject o) {
        json = o;
        at = nz(str(o, "at")); tz = nz(str(o, "tz"));
        JSONObject t = o.optJSONObject("today");
        JSONObject n = t == null ? null : t.optJSONObject("next");
        due = t == null ? 0 : t.optInt("due"); late = t == null ? 0 : t.optInt("late"); done = t == null ? 0 : t.optInt("done"); total = t == null ? 0 : t.optInt("total");
        next = n == null || str(n, "id") == null ? null : new Item(n);
        items = items(o.optJSONArray("items"));
        JSONObject h = o.optJSONObject("horizons");
        shortItems = items(h == null ? null : h.optJSONArray("short"));
        mediumItems = items(h == null ? null : h.optJSONArray("medium"));
        longItems = items(h == null ? null : h.optJSONArray("long"));
        blocked = o.optInt("blocked");
        List<Timer> ts = new ArrayList<>();
        JSONArray ta = o.optJSONArray("timers"); // absent in files from before v2.5: none running
        for (int i = 0; ta != null && i < ta.length(); i++) { JSONObject x = ta.optJSONObject(i); if (x != null && str(x, "id") != null) ts.add(new Timer(x)); }
        timers = Collections.unmodifiableList(ts);
        List<Project> ps = new ArrayList<>();
        JSONArray pa = o.optJSONArray("projects");
        for (int i = 0; pa != null && i < pa.length(); i++) { JSONObject p = pa.optJSONObject(i); if (p != null && str(p, "id") != null) ps.add(new Project(p)); }
        projects = Collections.unmodifiableList(ps);
        List<Day> ds = new ArrayList<>();
        JSONArray wa = o.optJSONArray("week");
        for (int i = 0; wa != null && i < wa.length(); i++) { JSONObject d = wa.optJSONObject(i); if (d != null) ds.add(new Day(d)); }
        week = Collections.unmodifiableList(ds);
    }

    /** The file's text, or null when it isn't a version-1 snapshot. */
    public static WidgetSnapshot parse(String text) {
        if (text == null) return null;
        try {
            JSONObject o = new JSONObject(text);
            return o.optInt("v") == 1 ? new WidgetSnapshot(o) : null;
        } catch (JSONException | RuntimeException e) {
            return null;
        }
    }

    // ---- ticking (W5, the optimistic half) ----

    /** The file's text right after a tick, or null when the task isn't in the snapshot. The task leaves every list; the counts it was part
     *  of move (due, late, done, its project's overdue, its day of the week). `total` stays. % done can't move: the snapshot has no task totals. */
    public String markingDone(String id) {
        Item it = find(id);
        if (it == null) return null;
        try {
            JSONObject s = new JSONObject(json.toString());
            JSONObject t = s.optJSONObject("today");
            if (t != null && (it.late || "Today".equals(it.dueLabel))) {
                t.put("due", Math.max(0, t.optInt("due") - 1));
                if (it.late) t.put("late", Math.max(0, t.optInt("late") - 1));
                t.put("done", t.optInt("done") + 1);
            }
            JSONArray kept = without(s.optJSONArray("items"), id);
            s.put("items", kept);
            JSONObject h = s.optJSONObject("horizons");
            if (h != null) for (String k : new String[] { "short", "medium", "long" }) if (h.has(k)) h.put(k, without(h.optJSONArray(k), id));
            JSONObject n = t == null ? null : t.optJSONObject("next");
            if (n != null && id.equals(str(n, "id"))) t.put("next", nextOf(kept)); // the builder's rule: due today first, then late
            JSONArray pa = s.optJSONArray("projects");
            for (int i = 0; it.late && it.project != null && pa != null && i < pa.length(); i++) {
                JSONObject p = pa.optJSONObject(i);
                if (p != null && it.project.equals(str(p, "id"))) p.put("overdue", Math.max(0, p.optInt("overdue") - 1));
            }
            String today = atDay();
            Integer off = today == null ? null : dayOffset(it.dueLabel, today);
            String day = off == null ? null : addDays(today, off);
            JSONArray wa = s.optJSONArray("week");
            String key = "short".equals(it.horizon) ? "short" : "medium".equals(it.horizon) ? "medium" : "long";
            for (int i = 0; day != null && wa != null && i < wa.length(); i++) {
                JSONObject d = wa.optJSONObject(i);
                if (d != null && day.equals(str(d, "day"))) d.put(key, Math.max(0, d.optInt(key) - 1));
            }
            return s.toString();
        } catch (JSONException e) {
            return null;
        }
    }

    // ---- timers (v2.5, the optimistic half of a Start or Stop tap; the twin of Snapshot.timing on iOS) ----

    /** The file's text right after Start or Stop on a task, or null when nothing changes (a task not in the snapshot, already running, or a bad action).
     *  Start: its rows say running and a timer from `at` leads the list (at most 5). Stop: the task's timers leave and its rows say stopped. */
    public String timing(String id, String action, String at) {
        boolean on = "start".equals(action);
        if (!on && !"stop".equals(action)) return null;
        Item it = find(id);
        if (on && (it == null || it.timerRunning || runningOn(id))) return null;
        try {
            JSONObject s = new JSONObject(json.toString());
            JSONArray old = s.optJSONArray("timers"), next = new JSONArray();
            if (on) next.put(new JSONObject().put("id", "widget-" + id).put("task_id", id).put("title", it.offline || it.title == null ? JSONObject.NULL : it.title).put("started_at", at).put("work", it.work));
            for (int i = 0; old != null && i < old.length() && next.length() < 5; i++) { JSONObject x = old.optJSONObject(i); if (x != null && !id.equals(str(x, "task_id"))) next.put(x); }
            s.put("timers", next);
            mark(s.optJSONArray("items"), id, on);
            JSONObject h = s.optJSONObject("horizons");
            if (h != null) for (String k : new String[] { "short", "medium", "long" }) mark(h.optJSONArray(k), id, on);
            JSONObject t = s.optJSONObject("today"), n = t == null ? null : t.optJSONObject("next");
            if (n != null && id.equals(str(n, "id"))) n.put("timer_running", on);
            return s.toString();
        } catch (JSONException e) {
            return null;
        }
    }

    private boolean runningOn(String id) { for (Timer t : timers) if (id.equals(t.taskId)) return true; return false; }

    private static void mark(JSONArray a, String id, boolean on) throws JSONException {
        for (int i = 0; a != null && i < a.length(); i++) { JSONObject o = a.optJSONObject(i); if (o != null && id.equals(str(o, "id"))) o.put("timer_running", on); }
    }

    private Item find(String id) {
        if (id == null) return null;
        List<Item> all = new ArrayList<>(items);
        all.addAll(shortItems); all.addAll(mediumItems); all.addAll(longItems);
        if (next != null) all.add(next);
        for (Item i : all) if (id.equals(i.id)) return i;
        return null;
    }

    private static JSONArray without(JSONArray a, String id) {
        JSONArray out = new JSONArray();
        for (int i = 0; a != null && i < a.length(); i++) { JSONObject o = a.optJSONObject(i); if (o == null || !id.equals(str(o, "id"))) out.put(a.opt(i)); }
        return out;
    }

    private static Object nextOf(JSONArray items) {
        for (int i = 0; i < items.length(); i++) { JSONObject o = items.optJSONObject(i); if (o != null && "Today".equals(str(o, "due_label"))) return o; }
        for (int i = 0; i < items.length(); i++) { JSONObject o = items.optJSONObject(i); if (o != null && o.optBoolean("late")) return o; }
        return JSONObject.NULL;
    }

    // ---- what a widget shows ----

    /** The large widget's footer: the latest of the projects' next milestones that can be named (an Offline project's can't); ties keep project order. */
    public Project footerMilestone() {
        Project best = null;
        for (Project p : projects) if (p.hasMilestone && p.milestoneName != null && !p.offline && (best == null || p.milestoneLateDays > best.milestoneLateDays)) best = p;
        return best;
    }

    public int weekOpen() { int n = 0; for (Day d : week) n += d.total(); return n; }

    /** The day (yyyy-MM-dd, the snapshot's zone) it was written, or null when `at` can't be read. */
    public String atDay() {
        if (at.length() < 19) return null;
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        try { return ymd(f.parse(at.substring(0, 19)).getTime(), tz); } catch (ParseException e) { return null; }
    }

    /** An ISO time ("2026-10-21T15:00:00.000Z") as epoch ms, or null. */
    static Long millis(String iso) {
        if (iso == null || iso.length() < 19) return null;
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        try { return f.parse(iso.substring(0, 19)).getTime(); } catch (ParseException e) { return null; }
    }

    /** Written on another day than `now` (in its zone): its "Today" is yesterday's until the app writes again. */
    public boolean isStale(long now) { String d = atDay(); return d == null || !d.equals(ymd(now, tz)); }

    // ---- dates (the snapshot's zone, plain yyyy-MM-dd) ----

    /** The next local midnight after `now` in `tz` (an unknown zone: the device's), when the widgets redraw so "Today" rolls over. */
    public static long nextMidnight(long now, String tz) {
        Calendar c = Calendar.getInstance(zone(tz), Locale.US);
        c.setTimeInMillis(now);
        c.add(Calendar.DAY_OF_MONTH, 1);
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    static TimeZone zone(String tz) {
        TimeZone z = TimeZone.getTimeZone(tz == null ? "" : tz);
        return z.getID().equals(tz) ? z : TimeZone.getDefault(); // an unknown id would otherwise be GMT
    }

    private static String format(Date d, String pattern, TimeZone z) {
        SimpleDateFormat f = new SimpleDateFormat(pattern, Locale.US);
        f.setTimeZone(z);
        return f.format(d);
    }

    public static String ymd(long millis, String tz) { return format(new Date(millis), "yyyy-MM-dd", zone(tz)); }
    /** "Tue Oct 21", for a widget's header. */
    public static String header(long millis, String tz) { return format(new Date(millis), "EEE MMM d", zone(tz)); }

    private static Date utcDay(String ymd) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        f.setLenient(false);
        try { return f.parse(ymd); } catch (ParseException | RuntimeException e) { return null; }
    }

    /** "Mon" for "2026-10-20"; "" for a day that can't be read. */
    public static String weekday(String ymd) { Date d = utcDay(ymd); return d == null ? "" : format(d, "EEE", TimeZone.getTimeZone("UTC")); }

    static String addDays(String ymd, int n) {
        Date d = utcDay(ymd);
        if (d == null) return null;
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.US);
        c.setTime(d);
        c.add(Calendar.DAY_OF_MONTH, n);
        return format(c.getTime(), "yyyy-MM-dd", TimeZone.getTimeZone("UTC"));
    }

    private static final List<String> DAYS = Arrays.asList("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat");

    /** Days from `today` to the day a due_label names: null for "Oct 30" (a week or more away) and "". */
    static Integer dayOffset(String label, String today) {
        if ("Today".equals(label)) return 0;
        if ("Tomorrow".equals(label)) return 1;
        if ("Yesterday".equals(label)) return -1;
        if (label != null && label.endsWith("d late")) {
            try { return -Integer.parseInt(label.substring(0, label.length() - 6)); } catch (NumberFormatException e) { return null; }
        }
        int want = DAYS.indexOf(label), now = DAYS.indexOf(weekday(today));
        if (want < 0 || now < 0) return null;
        int d = (want - now + 7) % 7;
        return d >= 2 ? d : null; // a weekday label means 2 to 6 days ahead
    }

    private static String str(JSONObject o, String k) { return o.isNull(k) ? null : o.optString(k, null); }
    private static String nz(String s) { return s == null ? "" : s; }

    private static List<Item> items(JSONArray a) {
        List<Item> out = new ArrayList<>();
        for (int i = 0; a != null && i < a.length(); i++) { JSONObject o = a.optJSONObject(i); if (o != null && str(o, "id") != null) out.add(new Item(o)); }
        return Collections.unmodifiableList(out);
    }
}
