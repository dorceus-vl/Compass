import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { Env, Variables } from './types.ts';
import { authGuard } from './middleware/auth-guard.ts';
import auth from './routes/auth.ts';
import projects, { milestones } from './routes/projects.ts';
import tasks from './routes/tasks.ts';
import views from './routes/views.ts';
import trash from './routes/trash.ts';
import inbox, { rules } from './routes/inbox.ts';
import meetings from './routes/meetings.ts';
import settings from './routes/settings.ts';
import push from './routes/push.ts';
import { stepUpChallenge } from './lib/step-up.ts';
import { email } from './email.ts';
import { runCron } from './cron.ts';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'"],
    workerSrc: ["'self'"], manifestSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"],
  },
  strictTransportSecurity: 'max-age=31536000; includeSubDomains', xFrameOptions: 'DENY', referrerPolicy: 'strict-origin-when-cross-origin',
}));
app.use('/api/*', authGuard);
app.route('/api/auth', auth);
app.route('/api/projects', projects);
app.route('/api/milestones', milestones);
app.route('/api/tasks', tasks);
app.route('/api/trash', trash);
app.route('/api/settings', settings);
app.route('/api/inbox', inbox);
app.route('/api/rules', rules);
app.route('/api/meetings', meetings);
app.route('/api/push', push);
app.post('/api/step-up/challenge', stepUpChallenge);
app.get('/api/email/address', (c) => c.json({ address: c.env.EMAIL_INBOX_ADDRESS || null }, 200, { 'Cache-Control': 'private, no-store' }));
app.route('/api', views);
app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => { console.error(err); return c.json({ error: 'Internal error' }, 500); });

export default {
  fetch: app.fetch,
  email,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCron(env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
